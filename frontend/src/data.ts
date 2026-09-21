export type Job = {
  id: string;
  title: string;
  company: string;
  description: string;
  date: string;
  sourceUrl: string;
  location: string;
  salary: string;
  tags: string[];
};
export type Draft = {
  id: string;
  to: string;
  subject: string;
  body: string;
  url?: string;
};
export type CalendarEvent = {
  id: string;
  title: string;
  date: string;
  time: string;
  type: string;
};
export type Trace = { tool: string; success: boolean; count?: number };
export type Message = {
  id: string;
  role: "user" | "assistant";
  text: string;
  trace?: Trace[];
};
export type Status = {
  connected: boolean;
  email?: string;
  googleConfigured: boolean;
  aiConfigured: boolean;
};
const today = Date.now();
export const demoJobs: Job[] = [
  {
    id: "demo-1",
    title: "Product Engineer",
    company: "Linear",
    location: "Remote · North America",
    salary: "$150k – $210k",
    tags: ["Full-time", "React", "TypeScript"],
    date: String(today - 3600000),
    sourceUrl: "",
    description:
      "Illustrative opportunity for exploring Culmin.\n\nHelp a small, thoughtful team build software that makes product development feel effortless. Work across the stack, from polished interfaces to reliable services.\n\nWhat you’ll work on\n• Build and ship customer-facing product features.\n• Collaborate closely with design and engineering.\n• Own projects from the first prototype to production.\n\nExperience with React, TypeScript, and a strong eye for detail would be a great starting point. This is sample data, not a verified opening.",
  },
  {
    id: "demo-2",
    title: "Frontend Engineer",
    company: "Notion",
    location: "San Francisco · Hybrid",
    salary: "$145k – $200k",
    tags: ["Full-time", "React", "Frontend"],
    date: String(today - 7200000),
    sourceUrl: "",
    description:
      "Illustrative opportunity. Build intuitive interfaces for a connected workspace. Collaborate with designers, improve accessibility, and help people bring their ideas to life.\n\nSample requirements: React, TypeScript, accessible UI development, and experience shipping web applications. This is sample data, not a verified opening.",
  },
  {
    id: "demo-3",
    title: "Software Engineer, Full Stack",
    company: "Vercel",
    location: "Remote · Worldwide",
    salary: "$140k – $190k",
    tags: ["Full-time", "Next.js", "Node.js"],
    date: String(today - 10800000),
    sourceUrl: "",
    description:
      "Illustrative opportunity. Help developers build a better web. Work on developer tools, deployment workflows, and performant full-stack applications.\n\nSample requirements: JavaScript, modern web frameworks, and API design. This is sample data, not a verified opening.",
  },
  {
    id: "demo-4",
    title: "Design Engineer",
    company: "Figma",
    location: "New York · Hybrid",
    salary: "$160k – $220k",
    tags: ["Full-time", "Design systems", "React"],
    date: String(today - 18000000),
    sourceUrl: "",
    description:
      "Illustrative opportunity. Bring design and code closer together. Prototype ideas, build reusable components, and refine the small details that make a product feel great.\n\nSample requirements: strong frontend fundamentals, interaction design, and accessible components. This is sample data, not a verified opening.",
  },
  {
    id: "demo-5",
    title: "Full Stack Developer",
    company: "Loom",
    location: "Remote · US & Canada",
    salary: "$130k – $180k",
    tags: ["Full-time", "TypeScript", "Node.js"],
    date: String(today - 86400000),
    sourceUrl: "",
    description:
      "Illustrative opportunity. Make asynchronous communication feel more human. Build recording, sharing, and collaboration experiences with a distributed team. This is sample data, not a verified opening.",
  },
  {
    id: "demo-6",
    title: "Software Engineer",
    company: "Raycast",
    location: "Remote · Europe",
    salary: "Not listed",
    tags: ["Full-time", "Developer tools", "React"],
    date: String(today - 172800000),
    sourceUrl: "",
    description:
      "Illustrative opportunity. Create fast, delightful tools for developers. Work on extensions and workflows that help people get more from their day. This is sample data, not a verified opening.",
  },
];
export async function api<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(`/api${path}`, {
    credentials: "same-origin",
    headers: { "Content-Type": "application/json", "X-Culmin-Client": "web" },
    ...(body === undefined ? {} : { method: "POST", body: JSON.stringify(body) }),
  });
  const data = await response.json().catch(() => ({
    error: "The server is unavailable. Start the Rust backend and try again.",
  }));
  if (!response.ok) throw new Error(data.error || "Something went wrong. Please try again.");
  return data as T;
}
export function localRead<T>(key: string, fallback: T): T {
  try {
    return JSON.parse(localStorage.getItem(key) || "null") ?? fallback;
  } catch {
    return fallback;
  }
}
export const toolLabels: Record<string, string> = {
  search_jobs: "Searched Gmail alerts",
  list_jobs: "Listed discovered jobs",
  get_job: "Read job details",
  create_email_draft: "Created email draft",
};
