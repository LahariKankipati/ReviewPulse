export type Session = {
  id: string;
  auth_user_id: string;
  email: string;
  name?: string;
  last_login_at: string | null;
};

export type Author = {
  id: string;
  auth_user_id: string;
  email: string;
  name?: string;
  last_login_at?: string | null;
  current_login_at?: string | null;
};

export type Book = {
  id: string;
  author_id: string;
  title: string;
  isbn?: string;
};

export type Job = {
  id: string;
  status: string;
  total_found: number;
  new_inserted: number;
  analyzed: number;
  failed: number;
  error?: string | null;
  started_at?: string;
  finished_at?: string;
};

export type ReviewAnalysis = {
  sentiment: "positive" | "mixed" | "negative";
  sentiment_confidence: number;
  themes: string[];
  ai_generated_flag: boolean;
  ai_confidence: number;
  summary: string;
  actionable: boolean;
  actionability_reason?: string;
  cost_usd?: number;
  tokens_in?: number;
  tokens_out?: number;
  model?: string;
};

export type ReviewItem = {
  review_id: string;
  book_id: string;
  title?: string;
  body: string;
  rating?: number;
  review_date?: string;
  source: string;
  analysis?: ReviewAnalysis | null;
};

export type SearchHit = {
  review_id: string;
  book_id: string;
  snippet: string;
  score: number;
};
