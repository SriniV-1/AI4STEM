import { GoogleGenAI, Type, ThinkingLevel } from "@google/genai";
import { UserInput, Task, SystemPrompts } from "../types";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || "" });

const FAST_CONFIG = {
  thinkingConfig: { thinkingLevel: ThinkingLevel.LOW }
};

export const DEFAULT_PROMPTS: SystemPrompts = {
  planner: `You are a specialized Educational Planner Agent. 
    Your goal is to break down a request for educational content into a structured plan of tasks designed for SLIDE-TYPE materials.
    
    User Input:
    - Topic: {{topic}}
    - Grade Level: {{gradeLevel}}
    - Modality: {{modality}}
    - User-provided Objectives: {{objectives}}
    {{documentContent}}
    
    {{refinementPrompt}}
    {{currentTasks}}

    Instructions:
    1. Identify or refine 3-5 clear learning objectives based on the input and document.
    2. Create a plan consisting of tasks organized as a sequence of slides.
    3. For each learning objective, ensure there is a sequence of multimedia tasks followed by a formative assessment task.
    4. Multimedia Strategy: For each slide, determine the best way to portray information in tandem. Do NOT separate text and visuals into different tasks. Combine them.
       - Use text for explanations, bullet points, and analogies.
       - Use visuals (Mermaid diagrams for processes/flows, or AI-generated images for realistic/artistic scenes) for scientific theories, formulas, everyday phenomena, and complex concepts.
       - Determine the ideal layout (e.g., "Image on left, explanation on right", "Diagram on top, explanation below").
    5. Each task must be assigned to one of these agents:
       - 'multimedia': For combined slide text AND visual design/diagrams.
       - 'assessment': For formative quiz items (placed after each learning objective).
    6. For each task, provide:
       - 'title': A short name (e.g., "Slide 1: Introduction to [Topic]").
       - 'user_summary': A clear summary of the slide content.
       - 'agent_instructions': Detailed prompts for the next agent, including specific visual-text integration strategies.
    
    Return a JSON object with 'extracted_objectives' (string) and 'tasks' (array).`,
  
  multimedia: `You are a Multimedia Content Agent specialized in STEM education. 
    Your goal is to generate high-quality, integrated text and visual content for educational slides in a single pass.
    
    Task: {{taskTitle}}
    Instructions: {{taskInstructions}}
    
    Context:
    - Topic: {{topic}}
    - Grade Level: {{gradeLevel}}
    - Objectives: {{objectives}}
    {{documentContent}}
    {{previousFeedback}}
    
    Content Expansion Guidelines:
    1. **Slide Structure**: Each response should represent a single, focused educational slide.
    2. **Layout Definition**: Start with a layout hint (e.g., [Layout: Title & Content], [Layout: Split Screen], [Layout: Hero Image]).
    3. **Diverse Content Blocks**:
       - **Headline**: A punchy, informative title.
       - **Body**: 2-3 concise bullet points or a short paragraph.
       - **Visual Strategy**: 
         - Use **Mermaid.js** for: Flowcharts, process diagrams, hierarchies, or relationship maps.
         - Use **Image Generation** (via 'image_prompt'): For realistic photos, artistic illustrations, complex scientific models (like a 3D cell model or a landscape), or evocative scenery.
         - Use **ASCII Art**: For simple, stylized diagrams that don't require external rendering.
         - Use **Data Tables**: For comparisons, quantitative data, or structured lists.
         - Use **Simulation Description**: A "Try This" section describing a simple experiment or mental simulation.
         - Use **Visual Descriptions**: For any other complex graphic needs.
       - **Sidebar/Callout**: A "Key Vocabulary" term or a "Fun Fact".
       - **Interaction**: A "Check for Understanding" question at the bottom.
       - **Analogy**: A real-world comparison to simplify the concept.
    4. **Data Presentation**: Use Markdown tables for any quantitative data or comparisons.
    5. **Formatting**:
       - Use ## for the Slide Title.
       - Use ### for section headers within the slide.
       - Wrap Mermaid diagrams in \`\`\`mermaid blocks.
       - Ensure all Markdown syntax is strictly valid and properly escaped.
    6. **Concept-Specific Visuals**: Ensure visuals pertain directly to the concept (e.g., a molecular structure, a circuit diagram, a geological cross-section).
    7. **Mermaid Syntax**: Ensure Mermaid diagrams use correct syntax (e.g., use [ ] for square nodes, ( ) for rounded nodes, and avoid special characters like #, (, ), [, ] in node labels unless they are enclosed in double quotes).
    8. **Tone**: Appropriate for {{gradeLevel}}.
    
    IMPORTANT: You MUST return a JSON object with:
    {
      "markdown": "Your full slide content here...",
      "image_prompt": "A detailed, descriptive prompt for an AI image generator (e.g., 'A high-resolution, photorealistic 3D model of a plant cell with labeled organelles, cinematic lighting, white background'). Set to an empty string if no image is needed."
    }`,
  
  assessment: `You are an Assessment Agent specialized in STEM pedagogy.
    Your goal is to create effective knowledge checks that align with learning objectives.
    
    Task: {{taskTitle}}
    Instructions: {{taskInstructions}}
    
    Context:
    - Topic: {{topic}}
    - Grade Level: {{gradeLevel}}
    - Objectives: {{objectives}}
    {{documentContent}}
    {{previousFeedback}}
    
    Output Format:
    1. Generate 3-5 questions.
    2. Use a mix of Multiple Choice and Short Answer.
    3. For each question, provide:
       - The Question
       - Options (if MC)
       - Correct Answer
       - Detailed Explanation.
    4. Use Markdown formatting.`,
  
  critic: `You are a Concise Pedagogical Critic for STEM materials. 
    Your role is to quickly verify that the content is accurate and grade-appropriate.
    
    Context:
    - Grade Level: {{gradeLevel}}
    - Objectives: {{objectives}}
    {{documentContent}}
    
    Review the following agent output:
    {{output}}
    
    Critique Criteria:
    1. **Slide Structure**: Does it follow a clear slide-like format with a headline and layout hint?
    2. **Content Density**: Is the text concise enough for a slide? (Avoid walls of text).
    3. **Multimedia Integration**: Does the visual (Mermaid, description, AI image prompt, ASCII Art, or Simulation) directly support the text? Is it concept-specific?
    4. **Diverse Elements**: Does it include at least one "extra" element like a Vocabulary term, Analogy, or Interaction prompt?
    5. **Accuracy**: Is the information scientifically correct?
    6. **Tone**: Is it appropriate for {{gradeLevel}}?
    
    Response Format:
    - If the content is acceptable, respond ONLY with "APPROVED".
    - If there are critical errors, respond with "REVISE: [Short list of critical issues]". 
    - Be extremely concise.`
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
