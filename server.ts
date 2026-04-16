import express from "express";
import { createServer as createViteServer } from "vite";
import Database from "better-sqlite3";
import { v4 as uuidv4 } from "uuid";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const db = new Database("ai4stem.db");

// Initialize Database
db.exec(`
  CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY,
    topic TEXT,
    grade_level TEXT,
    modality TEXT,
    objectives TEXT,
    extracted_objectives TEXT,
    document_content TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS tasks (
    id TEXT PRIMARY KEY,
    project_id TEXT,
    title TEXT,
    user_summary TEXT,
    agent_instructions TEXT,
    agent_type TEXT,
    status TEXT DEFAULT 'pending',
    output TEXT,
    feedback TEXT,
    image_url TEXT,
    image_prompt TEXT,
    FOREIGN KEY(project_id) REFERENCES projects(id)
  );
`);

// Robust migration: Add columns if they are missing
try {
  db.exec("ALTER TABLE projects ADD COLUMN extracted_objectives TEXT");
} catch (e) {}

try {
  db.exec("ALTER TABLE projects ADD COLUMN document_content TEXT");
} catch (e) {}

try {
  db.exec("ALTER TABLE tasks ADD COLUMN user_summary TEXT");
  // If we just added user_summary, try to migrate data from old 'description' column if it exists
  try {
    db.exec("UPDATE tasks SET user_summary = description WHERE user_summary IS NULL");
  } catch (e) {}
} catch (e) {}

try {
  db.exec("ALTER TABLE tasks ADD COLUMN agent_instructions TEXT");
} catch (e) {}

try {
  db.exec("ALTER TABLE tasks ADD COLUMN image_url TEXT");
} catch (e) {}

try {
  db.exec("ALTER TABLE tasks ADD COLUMN image_prompt TEXT");
} catch (e) {}

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ limit: '10mb', extended: true }));
  
  // Logging middleware
  app.use((req, res, next) => {
    console.log(`${new Date().toISOString()} - ${req.method} ${req.url}`);
    next();
  });

  const PORT = 3000;

  // API Routes
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok", timestamp: new Date().toISOString() });
  });

  app.post("/api/projects", (req, res) => {
    const { topic, grade_level, modality, objectives, extracted_objectives, document_content } = req.body;
    const id = uuidv4();
    db.prepare("INSERT INTO projects (id, topic, grade_level, modality, objectives, extracted_objectives, document_content) VALUES (?, ?, ?, ?, ?, ?, ?)").run(id, topic, grade_level, modality, objectives, extracted_objectives || null, document_content || null);
    res.json({ id });
  });

  app.get("/api/projects/:id", (req, res) => {
    const project = db.prepare("SELECT * FROM projects WHERE id = ?").get(req.params.id);
    if (!project) return res.status(404).json({ error: "Project not found" });
    const tasks = db.prepare("SELECT * FROM tasks WHERE project_id = ?").all(req.params.id);
    res.json({ ...project, tasks });
  });

  app.patch("/api/projects/:id", (req, res) => {
    const { extracted_objectives } = req.body;
    db.prepare("UPDATE projects SET extracted_objectives = ? WHERE id = ?").run(extracted_objectives, req.params.id);
    res.json({ success: true });
  });

  app.delete("/api/projects/:id/tasks", (req, res) => {
    db.prepare("DELETE FROM tasks WHERE project_id = ?").run(req.params.id);
    res.json({ success: true });
  });

  app.post("/api/tasks", (req, res) => {
    const { project_id, tasks } = req.body;
    const insert = db.prepare("INSERT INTO tasks (id, project_id, title, user_summary, agent_instructions, agent_type, image_url, image_prompt) VALUES (?, ?, ?, ?, ?, ?, ?, ?)");
    
    const transaction = db.transaction((ts) => {
      for (const t of ts) {
        insert.run(uuidv4(), project_id, t.title, t.user_summary, t.agent_instructions, t.agent_type, t.image_url || null, t.image_prompt || null);
      }
    });
    
    transaction(tasks);
    res.json({ success: true });
  });

  app.patch("/api/tasks/:id", (req, res) => {
    const { status, output, feedback, image_url, image_prompt } = req.body;
    db.prepare("UPDATE tasks SET status = ?, output = ?, feedback = ?, image_url = ?, image_prompt = ? WHERE id = ?").run(status, output, feedback, image_url || null, image_prompt || null, req.params.id);
    res.json({ success: true });
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.join(__dirname, "dist")));
    app.get("*", (req, res) => {
      res.sendFile(path.join(__dirname, "dist", "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
