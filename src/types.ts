export interface SystemPrompts {
  planner: string;
  multimedia: string;
  assessment: string;
  critic: string;
}

export interface Project {
  id: string;
  topic: string;
  grade_level: string;
  modality: string;
  objectives: string;
  extracted_objectives?: string;
  tasks: Task[];
}

export interface Task {
  id: string;
  project_id: string;
  title: string;
  user_summary: string;
  agent_instructions: string;
  agent_type: 'multimedia' | 'assessment';
  status: 'pending' | 'working' | 'completed' | 'failed';
  output: string;
  image_url?: string;
  image_prompt?: string;
  feedback?: string;
}

export interface UserInput {
  topic: string;
  gradeLevel: string;
  modality: string;
  objectives: string;
  documentContent?: string;
}
