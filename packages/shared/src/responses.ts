// What the API sends back, as the web app reads it. Plain types: the API
// and the web app are built together, so the answers are not checked again
// at run time. Dates arrive as ISO 8601 text, e.g. "2026-10-30T09:00:00.000Z".

// The signed-in person (GET /api/auth/me, sign-in and sign-up).
export interface Me {
  id: string;
  email: string;
  displayName: string;
  isServerAdmin: boolean;
}

// GET /api/server/settings
export interface ServerSettings {
  signUpOpen: boolean;
}

export interface Project {
  id: string;
  name: string;
  description: string | null;
  code: string;
  timeZone: string;
  createdAt: string;
}

// GET /api/projects/suggest-code
export interface SuggestedCode {
  code: string;
}

export interface Board {
  id: string;
  projectId: string;
  name: string;
  createdAt: string;
}

// The body of every 4xx answer. `message` says what is wrong, in words that
// can be shown to people.
export interface ApiErrorBody {
  statusCode: number;
  message: string;
  error?: string;
}
