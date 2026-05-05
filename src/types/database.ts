export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type CaptureStatus = "queued" | "processing" | "completed" | "failed" | "ignored";
export type CaptureType = "link" | "text" | "image";
export type ExtractionStatus = "extracted" | "fallback";
export type JobStatus = "queued" | "running" | "completed" | "failed";
export type JobType = "process_capture";
export type WikiPageStatus = "draft" | "published" | "archived";
export type AuditStatus = "success" | "failure" | "denied";
export type KnowledgeDiscoveryStatus = "new" | "seen" | "ignored";
export type KnowledgeDiscoveryType = "new_source" | "related_wiki" | "duplicate_source" | "suggested_question";
export type KnowledgeRecommendationStatus = "active" | "dismissed";

export interface RawAttachment {
  kind: "image" | "audio" | "file";
  url: string;
  name?: string | null;
  mime_type?: string | null;
  size_bytes?: number | null;
  storage?: "local" | "remote" | null;
}

export interface Capture {
  id: string;
  user_id: string;
  type: CaptureType;
  raw_url: string | null;
  raw_text: string | null;
  file_url: string | null;
  raw_payload: Json;
  raw_attachments: RawAttachment[];
  note: string | null;
  status: CaptureStatus;
  created_at: string;
}

export interface ProcessingJob {
  id: string;
  capture_id: string;
  user_id: string;
  job_type: JobType;
  status: JobStatus;
  current_step: string;
  step_status: Json;
  error_message: string | null;
  started_at: string | null;
  finished_at: string | null;
  created_at: string;
}

export interface ExtractedContent {
  id: string;
  capture_id: string;
  user_id: string;
  title: string;
  content_text: string;
  content_format: string;
  extraction_method: string;
  status: ExtractionStatus;
  metadata: Json;
  error_message: string | null;
  created_at: string;
}

export interface Source {
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
}

export interface WikiPage {
  id: string;
  user_id: string;
  title: string;
  slug: string;
  content_markdown: string;
  status: WikiPageStatus;
  created_at: string;
  updated_at: string;
}

export interface AuditLog {
  id: string;
  user_id: string;
  action: string;
  resource_type: string;
  resource_id: string | null;
  status: AuditStatus;
  metadata: Json;
  ip_address: string | null;
  user_agent: string | null;
  created_at: string;
}

export interface AskHistory {
  id: string;
  user_id: string;
  scope_type: "wiki_page" | "source" | "global";
  scope_id: string | null;
  question: string;
  answer: string;
  citations: Json;
  metadata: Json;
  created_at: string;
}

export interface KnowledgeDiscovery {
  id: string;
  user_id: string;
  discovery_type: KnowledgeDiscoveryType;
  title: string;
  body: string;
  source_id: string | null;
  wiki_page_id: string | null;
  related_source_id: string | null;
  related_wiki_page_id: string | null;
  suggested_question: string | null;
  status: KnowledgeDiscoveryStatus;
  metadata: Json;
  dedupe_key: string;
  created_at: string;
  updated_at: string;
}

export interface KnowledgeRecommendation {
  id: string;
  user_id: string;
  source_id: string;
  trigger_source_id: string | null;
  reason: string;
  score: number;
  status: KnowledgeRecommendationStatus;
  metadata: Json;
  dedupe_key: string;
  created_at: string;
  updated_at: string;
}

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
          raw_payload: Json;
          raw_attachments: RawAttachment[];
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
          raw_payload?: Json;
          raw_attachments?: RawAttachment[];
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
          current_step: string;
          step_status: Json;
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
          current_step?: string;
          step_status?: Json;
          error_message?: string | null;
          started_at?: string | null;
          finished_at?: string | null;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["processing_jobs"]["Insert"]>;
      };
      extracted_contents: {
        Row: {
          id: string;
          capture_id: string;
          user_id: string;
          title: string;
          content_text: string;
          content_format: string;
          extraction_method: string;
          status: ExtractionStatus;
          metadata: Json;
          error_message: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          capture_id: string;
          user_id: string;
          title: string;
          content_text: string;
          content_format?: string;
          extraction_method: string;
          status?: ExtractionStatus;
          metadata?: Json;
          error_message?: string | null;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["extracted_contents"]["Insert"]>;
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
      audit_logs: {
        Row: {
          id: string;
          user_id: string;
          action: string;
          resource_type: string;
          resource_id: string | null;
          status: AuditStatus;
          metadata: Json;
          ip_address: string | null;
          user_agent: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          action: string;
          resource_type: string;
          resource_id?: string | null;
          status: AuditStatus;
          metadata?: Json;
          ip_address?: string | null;
          user_agent?: string | null;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["audit_logs"]["Insert"]>;
      };
      ask_histories: {
        Row: {
          id: string;
          user_id: string;
          scope_type: "wiki_page" | "source" | "global";
          scope_id: string | null;
          question: string;
          answer: string;
          citations: Json;
          metadata: Json;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          scope_type: "wiki_page" | "source" | "global";
          scope_id?: string | null;
          question: string;
          answer: string;
          citations?: Json;
          metadata?: Json;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["ask_histories"]["Insert"]>;
      };
      knowledge_discoveries: {
        Row: {
          id: string;
          user_id: string;
          discovery_type: KnowledgeDiscoveryType;
          title: string;
          body: string;
          source_id: string | null;
          wiki_page_id: string | null;
          related_source_id: string | null;
          related_wiki_page_id: string | null;
          suggested_question: string | null;
          status: KnowledgeDiscoveryStatus;
          metadata: Json;
          dedupe_key: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          discovery_type: KnowledgeDiscoveryType;
          title: string;
          body: string;
          source_id?: string | null;
          wiki_page_id?: string | null;
          related_source_id?: string | null;
          related_wiki_page_id?: string | null;
          suggested_question?: string | null;
          status?: KnowledgeDiscoveryStatus;
          metadata?: Json;
          dedupe_key: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["knowledge_discoveries"]["Insert"]>;
      };
      knowledge_recommendations: {
        Row: {
          id: string;
          user_id: string;
          source_id: string;
          trigger_source_id: string | null;
          reason: string;
          score: number;
          status: KnowledgeRecommendationStatus;
          metadata: Json;
          dedupe_key: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          source_id: string;
          trigger_source_id?: string | null;
          reason: string;
          score?: number;
          status?: KnowledgeRecommendationStatus;
          metadata?: Json;
          dedupe_key: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["knowledge_recommendations"]["Insert"]>;
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
