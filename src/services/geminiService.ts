import { GoogleGenAI, Type, ThinkingLevel } from "@google/genai";
import { UserInput, Task, SystemPrompts } from "../types";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || "" });

const FAST_CONFIG = {
  thinkingConfig: { thinkingLevel: ThinkingLevel.LOW }
};

export const DEFAULT_PROMPTS: SystemPrompts = {
  planner: `You are a specialized Educational Planner Agent based on the Cognitive Theory of Multimedia Learning (CTML).
    Your goal is to break down a request for educational content into a structured sequence of slides, optimized for cognitive load.
    
    Principles to follow:
    - Segmenting Principle: Break complex topics into small, manageable slide-sized chunks.
    - Pre-training Principle: Introduce key terms or concepts before complex processes.
    - Multimedia Principle: Plan for a mix of textual explanations and structural visuals.
    
    User Input:
    - Topic: {{topic}}
    - Grade Level: {{gradeLevel}}
    - Modality: {{modality}}
    - User-provided Objectives: {{objectives}}
    {{documentContent}}
    
    {{refinementPrompt}}
    {{currentTasks}}

    Instructions:
    1. Identify 3-5 clear learning objectives.
    2. Sequence slides to build complexity gradually (Pre-training).
    3. Multimedia Strategy: For each slide, define how text and visuals will work together.
    4. Each task must be assigned to either 'multimedia' or 'assessment'.
    5. Provide 'title', 'user_summary', and 'agent_instructions' for each slide.
    
    Return a JSON object with 'extracted_objectives' (string) and 'tasks' (array).`,
  
  multimedia: `You are a Multimedia Content Agent specialized in CTML-optimized STEM education. 
    Your goal is to generate high-quality, integrated text and visual content that resembles a modern educational article (e.g., National Geographic or Scientific American).
    
    **CTML Design Directives**:
    1. **Multimedia Principle**: Use words and graphics rather than words alone.
    2. **Signaling Principle**: Highlight essential material (e.g., use bold for key terms, clear headers).
    3. **Coherence Principle**: Exclude extraneous material. Keep text concise and relevant only to the specific slide goal.
    4. **Spatial Contiguity Principle**: Present words near corresponding parts of the graphic.
    5. **Redundancy Principle**: Do not repeat the exact same information in text if it is already explicitly clear in the graphic.
    6. **Personalization Principle**: Use a conversational, engaging, yet professional tone (e.g., "Imagine...", "Let's explore...").

    Task: {{taskTitle}}
    Instructions: {{taskInstructions}}
    
    Context:
    - Topic: {{topic}} | Grade: {{gradeLevel}}
    - Objectives: {{objectives}}
    {{documentContent}}
    {{previousFeedback}}
    
    Markdown Content Structure:
    - [Layout Hint]: Choose one (e.g., [Layout: Infographic], [Layout: Side-by-Side], [Layout: Feature Article]).
    - ## Slide Title: Clear and catchy.
    - ### Focus Section: A specific sub-topic.
    - Content: Use bullets or short paragraphs. Aim for "magazine article" quality.
    - **Visual Strategy**:
      - Use **Mermaid.js** for: Systems, cycles, and relationships.
      - Use **AI Image Prompt**: For immersive, visual anchoring. Define it in the separate 'image_prompt' field.
    - Sidebar: A "Did You Know?" or "Key Vocabulary" callout.
    - Try This/Think About: A simple application or reflection.
    
    Return JSON:
    {
      "markdown": "Full content...",
      "image_prompt": "Descriptive prompt (e.g., 'A professional scientific illustration of...') or empty string."
    }`,
  
  assessment: `You are a Pedagogical Assessment Agent.
    Create formative evaluation items that check for deep understanding, not just rote memorization.
    
    Task: {{taskTitle}}
    Instructions: {{taskInstructions}}
    
    Return Markdown with 3-5 high-quality questions (MCQ/Short Answer) with explanations.`,
  
  critic: `You are a CTML Quality Critic.
    Review the output and ensure it doesn't violate core multimedia learning principles.
    
    Checklist:
    1. **Coherence**: Is there any irrelevant "fluff" that should be removed?
    2. **Signaling**: Are key points highlighted?
    3. **Spatial Contiguity**: Is the layout hint appropriate for the content?
    4. **Redundancy**: Does the text complement the visual rather than duplicating it?
    5. **Grade Appropriateness**: Is the language right for {{gradeLevel}}?
    
    Respond with "APPROVED" or "REVISE: [Reason]".`
};

export const PROMPT_PRESETS: Record<string, SystemPrompts> = {
  standard: DEFAULT_PROMPTS,
  creative: {
    planner: `You are a Creative Educational Planner. Break down the topic into a narrative-driven slide deck. Focus on storytelling and emotional connection. Use multimedia tasks to weave stories and visuals (including AI-generated artistic scenes) together.`,
    multimedia: `You are a Creative Multimedia Agent. Write engaging, narrative-style explanations and suggest evocative, artistic diagrams or AI-generated images that pertain to the story and concepts.`,
    assessment: `You are a Creative Assessment Agent. Create "Challenge" questions that require application of concepts in novel scenarios.`,
    critic: `You are a Creative Critic. Ensure the storytelling is accurate, the analogies are scientifically sound, and the multimedia integration (including AI images) is immersive.`
  },
  concise: {
    planner: `You are a Concise Educational Planner. Create a high-density, fact-focused slide deck using multimedia tasks for maximum clarity. Use functional diagrams and clear AI-generated visuals where they aid precision.`,
    multimedia: `You are a Concise Multimedia Agent. Use bullet points and high-clarity, minimal technical diagrams or AI-generated images. Focus on data visualization and precision.`,
    assessment: `You are a Concise Assessment Agent. Create quick-fire knowledge checks.`,
    critic: `You are a Concise Critic. Ensure brevity, technical precision, and that visuals (including AI images) are strictly functional.`
  }
};

function extractJson(text: string) {
  try {
    // Try direct parse
    return JSON.parse(text);
  } catch (e) {
    // Try to find JSON in markdown blocks
    const match = text.match(/```json\n?([\s\S]*?)\n?```/) || text.match(/```\n?([\s\S]*?)\n?```/);
    if (match) {
      try {
        return JSON.parse(match[1]);
      } catch (e2) {
        console.error("Failed to parse extracted JSON", e2);
      }
    }
    throw new Error("Could not parse JSON from model response");
  }
}

/**
 * PLANNER AGENT
 */
export async function plannerAgent(input: UserInput, prompts: SystemPrompts, refinementPrompt?: string, currentTasks?: any[]) {
  const promptTemplate = prompts.planner;
  const finalPrompt = promptTemplate
    .replace('{{topic}}', input.topic)
    .replace('{{gradeLevel}}', input.gradeLevel)
    .replace('{{modality}}', input.modality)
    .replace('{{objectives}}', input.objectives || "Not provided")
    .replace('{{documentContent}}', input.documentContent ? `- Reference Document Content: ${input.documentContent.substring(0, 2500)}` : "")
    .replace('{{refinementPrompt}}', refinementPrompt ? `The user wants to refine the current plan: "${refinementPrompt}"` : "")
    .replace('{{currentTasks}}', currentTasks ? `Current plan: ${JSON.stringify(currentTasks)}` : "");

  const response = await ai.models.generateContent({
    model: "gemini-3.1-flash-lite-preview",
    contents: finalPrompt,
    config: {
      ...FAST_CONFIG,
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          extracted_objectives: { type: Type.STRING },
          tasks: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                title: { type: Type.STRING },
                user_summary: { type: Type.STRING },
                agent_instructions: { type: Type.STRING },
                agent_type: { type: Type.STRING, enum: ["multimedia", "assessment"] }
              },
              required: ["title", "user_summary", "agent_instructions", "agent_type"]
            }
          }
        },
        required: ["extracted_objectives", "tasks"]
      }
    }
  });

  return extractJson(response.text || "{}");
}

/**
 * IMAGE GENERATION
 */
export async function generateImage(prompt: string) {
  if (!prompt || prompt.trim().length < 5) {
    console.warn("Image prompt too short or empty:", prompt);
    return null;
  }
  
  try {
    console.log("Generating image with prompt:", prompt);
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash-image",
      contents: prompt,
      config: {
        ...FAST_CONFIG,
        imageConfig: {
          aspectRatio: "16:9",
          imageSize: "512px"
        }
      }
    });

    for (const part of response.candidates?.[0]?.content?.parts || []) {
      if (part.inlineData) {
        return `data:image/png;base64,${part.inlineData.data}`;
      }
    }
    return null;
  } catch (error) {
    console.error("Image generation failed:", error);
    return null;
  }
}

/**
 * MULTIMEDIA AGENT
 */
export async function multimediaAgent(task: Task, project: any, prompts: SystemPrompts, previousFeedback?: string) {
  const promptTemplate = prompts.multimedia;
  const finalPrompt = promptTemplate
    .replace('{{taskTitle}}', task.title)
    .replace('{{taskInstructions}}', task.agent_instructions)
    .replace('{{topic}}', project.topic)
    .replace('{{gradeLevel}}', project.grade_level)
    .replace('{{objectives}}', project.extracted_objectives || project.objectives)
    .replace('{{documentContent}}', project.document_content ? `- Reference Document Content: ${project.document_content.substring(0, 2500)}` : "")
    .replace('{{previousFeedback}}', previousFeedback ? `IMPORTANT: The previous version was rejected. Fix these issues: ${previousFeedback}` : "");

  const response = await ai.models.generateContent({
    model: "gemini-3.1-flash-lite-preview",
    contents: finalPrompt,
    config: {
      ...FAST_CONFIG,
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          markdown: { type: Type.STRING },
          image_prompt: { type: Type.STRING }
        },
        required: ["markdown", "image_prompt"]
      }
    }
  });

  return extractJson(response.text || "{}");
}

/**
 * ASSESSMENT AGENT
 */
export async function assessmentAgent(task: Task, project: any, prompts: SystemPrompts, previousFeedback?: string) {
  const promptTemplate = prompts.assessment;
  const finalPrompt = promptTemplate
    .replace('{{taskTitle}}', task.title)
    .replace('{{taskInstructions}}', task.agent_instructions)
    .replace('{{topic}}', project.topic)
    .replace('{{gradeLevel}}', project.grade_level)
    .replace('{{objectives}}', project.extracted_objectives || project.objectives)
    .replace('{{documentContent}}', project.document_content ? `- Reference Document Content: ${project.document_content.substring(0, 2500)}` : "")
    .replace('{{previousFeedback}}', previousFeedback ? `IMPORTANT: The previous version was rejected. Fix these issues: ${previousFeedback}` : "");

  const response = await ai.models.generateContent({
    model: "gemini-3.1-flash-lite-preview",
    contents: finalPrompt,
    config: FAST_CONFIG,
  });

  return response.text;
}

/**
 * CRITIC AGENT
 */
export async function criticAgent(output: string, task: Task, project: any, prompts: SystemPrompts) {
  const promptTemplate = prompts.critic;
  const finalPrompt = promptTemplate
    .replace('{{gradeLevel}}', project.grade_level)
    .replace('{{objectives}}', project.extracted_objectives || project.objectives)
    .replace('{{documentContent}}', project.document_content ? `- Reference Document Content: ${project.document_content.substring(0, 2500)}` : "")
    .replace('{{output}}', output);

  const response = await ai.models.generateContent({
    model: "gemini-3.1-flash-lite-preview",
    contents: finalPrompt,
    config: FAST_CONFIG,
  });

  return response.text;
}
