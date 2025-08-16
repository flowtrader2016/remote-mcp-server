export interface Article {
  url: string;
  s3_path_html: string;
  s3_path_llm_result?: string;
  domain_folder?: string;
  file_name?: string;
  article_type?: string;
  article_date?: string;
  date_original?: string;
  sectors?: string[];
  threat_types?: string[];
  threat_actor_type?: string;
  threat_actor_name?: string[];
  compliance?: string[];
  threat_sophistication_level?: string;
  attack_vectors?: string[];
  targeted_assets?: string[];
  severity_level?: string;
  regions?: string[];
  services_impacted?: string[];
  products_impacted?: string[];
  mitigation_actions?: string[];
  cloud_platforms?: string[];
  affected_organizations?: string[];
  cve_identifiers?: string[];
  related_incidents?: string[];
  original_source_name?: string;
  original_source_url?: string;
  title?: string;
  summary?: string;
  article_text_md_original?: string;
  ciso_summary_key_points?: string[];
  [key: string]: any;
}

export interface SearchMetadata {
  generated_at: string;
  last_update: string;
  total_articles: number;
  bucket: string;
  articles: Article[];
}

export interface FieldInfo {
  field: string;
  type: string;
  description: string;
  examples?: string[];
  total_unique_values?: number;
}

export interface SearchFilters {
  [fieldName: string]: string[];
}

export interface QueryOptions {
  filters?: SearchFilters;
  since_date?: string;
  limit?: number;
  summary_mode?: boolean;
}