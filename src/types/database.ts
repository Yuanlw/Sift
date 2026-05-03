export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type CaptureStatus = "queued" | "processing" | "completed" | "failed";
export type CaptureType = "link" | "text" | "image";
export type JobStatus = "queued" | "running" | "completed" | "failed";
export type JobType = "process_capture";
export type WikiPageStatus = "draft" | "published" | "archived";

export interface Database {
  public: {
    Tables: {
      captures: {
        Row: {
          id: string;
          user_id: string;
          type: CaptureType;
          raw_url: string | null;
          raw_text: string | null;
          file_url: string | null;
          note: string | null;
          status: CaptureStatus;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          type: CaptureType;
          raw_url?: string | null;
          raw_text?: string | null;
          file_url?: string | null;
          note?: string | null;
          status?: CaptureStatus;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["captures"]["Insert"]>;
      };
      processing_jobs: {
        Row: {
          id: string;
          capture_id: string;
          user_id: string;
          job_type: JobType;
          status: JobStatus;
          error_message: string | null;
          started_at: string | null;
          finished_at: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          capture_id: string;
          user_id: string;
          job_type: JobType;
          status?: JobStatus;
          error_message?: string | null;
          started_at?: string | null;
          finished_at?: string | null;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["processing_jobs"]["Insert"]>;
      };
      sources: {
        Row: {
          id: string;
          capture_id: string;
          user_id: string;
          title: string;
          source_type: CaptureType;
          original_url: string | null;
          extracted_text: string;
          summary: string | null;
          metadata: Json;
          created_at: string;
        };
        Insert: {
          id?: string;
          capture_id: string;
          user_id: string;
          title: string;
          source_type: CaptureType;
          original_url?: string | null;
          extracted_text: string;
          summary?: string | null;
          metadata?: Json;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["sources"]["Insert"]>;
      };
      wiki_pages: {
        Row: {
          id: string;
          user_id: string;
          title: string;
          slug: string;
          content_markdown: string;
          status: WikiPageStatus;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          title: string;
          slug: string;
          content_markdown: string;
          status?: WikiPageStatus;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["wiki_pages"]["Insert"]>;
      };
      source_wiki_pages: {
        Row: {
          source_id: string;
          wiki_page_id: string;
          relation_type: string;
          confidence: number | null;
          created_at: string;
        };
        Insert: {
          source_id: string;
          wiki_page_id: string;
          relation_type: string;
          confidence?: number | null;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["source_wiki_pages"]["Insert"]>;
      };
      chunks: {
        Row: {
          id: string;
          user_id: string;
          parent_type: "source" | "wiki_page";
          parent_id: string;
          content: string;
          embedding: string | null;
          token_count: number | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          parent_type: "source" | "wiki_page";
          parent_id: string;
          content: string;
          embedding?: string | null;
          token_count?: number | null;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["chunks"]["Insert"]>;
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: {
      capture_type: CaptureType;
      capture_status: CaptureStatus;
      job_type: JobType;
      job_status: JobStatus;
      wiki_page_status: WikiPageStatus;
    };
    CompositeTypes: Record<string, never>;
  };
}
