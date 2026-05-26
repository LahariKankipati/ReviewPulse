import { request } from "./client";
import type { Author, Book, Job, ReviewItem, SearchHit } from "../types/domain";

export function checkHealth() {
  return request<{ status: string; env: string }>("/health");
}

export function loginAuthor(email: string) {
  return request<Author>("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ email }),
  });
}

export function registerAuthor(payload: { auth_user_id: string; email: string; name: string }) {
  return request<Author>("/api/authors", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function listBooks(authorId: string) {
  return request<{ items: Book[] }>(`/api/authors/${authorId}/books`);
}

export function createBook(authorId: string, payload: { title: string; isbn?: string; source_url?: string }) {
  return request<Book>(`/api/authors/${authorId}/books`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function triggerIngestion(bookId: string, syntheticCount: number) {
  return request<{ job_id: string; status: string }>(`/api/books/${bookId}/ingest`, {
    method: "POST",
    body: JSON.stringify({ synthetic_count: syntheticCount }),
  });
}

export function getJob(jobId: string) {
  return request<Job>(`/api/jobs/${jobId}`);
}

export function listBookReviews(bookId: string, authorId: string, pageSize = 80) {
  const params = new URLSearchParams({ author_id: authorId, page: "1", page_size: String(pageSize) });
  return request<{ items: ReviewItem[] }>(`/api/books/${bookId}/reviews?${params}`);
}

export function semanticSearch(authorId: string, query: string, topK = 10) {
  return request<{ query: string; provider: string; model: string; items: SearchHit[] }>(
    `/api/authors/${authorId}/search`,
    { method: "POST", body: JSON.stringify({ query, top_k: topK }) }
  );
}
