import { request } from "./client";
import type { Author, Book, Job, ReviewItem, SearchHit } from "../types/domain";

// Pings the backend health endpoint to verify the service is reachable.
export function checkHealth() {
  return request<{ status: string; env: string }>("/health");
}

// Authenticates an existing author by email and returns their profile.
export function loginAuthor(email: string) {
  return request<Author>("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ email }),
  });
}

// Registers a new author account and returns the created author profile.
export function registerAuthor(payload: { auth_user_id: string; email: string; name: string }) {
  return request<Author>("/api/authors", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

// Fetches all books belonging to the given author.
export function listBooks(authorId: string) {
  return request<{ items: Book[] }>(`/api/authors/${authorId}/books`);
}

// Creates a new book record under the given author and returns it.
export function createBook(authorId: string, payload: { title: string; isbn?: string; source_url?: string }) {
  return request<Book>(`/api/authors/${authorId}/books`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

// Starts an ingestion job that generates and analyzes synthetic reviews for the given book.
export function triggerIngestion(bookId: string, syntheticCount: number) {
  return request<{ job_id: string; status: string }>(`/api/books/${bookId}/ingest`, {
    method: "POST",
    body: JSON.stringify({ synthetic_count: syntheticCount }),
  });
}

// Fetches the current status and counters for a specific ingestion job.
export function getJob(jobId: string, authorId: string) {
  return request<Job>(`/api/jobs/${jobId}?author_id=${authorId}`);
}

// Permanently deletes a book and all its associated reviews and analysis data.
export function deleteBook(bookId: string, authorId: string) {
  return request<{ deleted: boolean }>(`/api/books/${bookId}?author_id=${authorId}`, { method: "DELETE" });
}

// Fetches the first page of reviews for a book, up to pageSize items.
export function listBookReviews(bookId: string, authorId: string, pageSize = 80) {
  const params = new URLSearchParams({ author_id: authorId, page: "1", page_size: String(pageSize) });
  return request<{ items: ReviewItem[] }>(`/api/books/${bookId}/reviews?${params}`);
}

// Runs a semantic vector search over the author's reviews and returns ranked result snippets.
export function semanticSearch(authorId: string, query: string, topK = 10) {
  return request<{ query: string; provider: string; model: string; items: SearchHit[] }>(
    `/api/authors/${authorId}/search`,
    { method: "POST", body: JSON.stringify({ query, top_k: topK }) }
  );
}
