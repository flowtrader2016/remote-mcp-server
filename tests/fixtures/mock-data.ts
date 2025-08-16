import type { Article, SearchMetadata } from '../../src/types';

// Sample articles based on actual data from search_metadata.json
export const mockArticles: Article[] = [
  {
    url: "https://www.theregister.com/2024/12/11/sichuan_silence_sophos_zeroday_sanctions/",
    s3_path_html: "register_security/2024/12/2024_12_11_sichuan_silence_sophos_zeroday_sanctions/2024_12_11_sichuan_silence_sophos_zeroday_sanctions.html",
    s3_path_llm_result: "register_security/2024/12/2024_12_11_sichuan_silence_sophos_zeroday_sanctions/2024_12_11_sichuan_silence_sophos_zeroday_sanctions_llm_result.json",
    domain_folder: "register_security",
    file_name: "2024_12_11_sichuan_silence_sophos_zeroday_sanctions",
    article_type: "APTActivity",
    article_date: "2024-12-11",
    sectors: ["PrivacyandSecurity"],
    threat_types: ["SQLInjection", "Vulnerabilities"],
    threat_actor_type: "Nation-State",
    threat_actor_name: ["GuanTianfeng", "SichuanSilenceInformationTechnologyCoLtd"],
    compliance: ["CFAA"],
    threat_sophistication_level: "High",
    attack_vectors: ["Web"],
    targeted_assets: ["Data(PII,Financial,IntellectualProperty)", "Infrastructure(Servers,Networks)"],
    severity_level: "Critical",
    regions: ["China", "UnitedStates"],
    services_impacted: ["Firewall"],
    products_impacted: ["SophosXGfirewall"],
    mitigation_actions: ["Hotfix"],
    affected_organizations: ["SichuanSilenceInformationTechnologyCoLtd"],
    environment: "On-Prem",
    mitre_attack_tactics: ["CommandandControl"],
    cve_identifiers: ["CVE-2020-12271"],
    threat_intelligence_source_types: ["GovernmentAgencies"],
    threat_intelligence_source_names: ["USDepartmentofTreasury", "USDepartmentofJustice"],
    financial_impact_estimate: "Significant($100,000-$1,000,000)",
    financial_impact_estimate_in_article: true,
    related_incidents: [],
    lessons_learned: ["TheUSwillnottoleratemaliciancyberattacks", "Theneedforprotectingcriticalinfrastructure"],
    summary: "A Chinese man and his company are being charged with exploitation of a zero-day SQL injection flaw in Sophos firewall",
    ciso_summary_key_points: ["Chinese hacker charged with zero-day SQL injection exploit", "Attack affected over 81,000 Sophos firewalls"],
    ciso_summary_actionable_takeaways: ["Improve vulnerability management processes", "Continue working with government agencies"],
    cloud_platforms: [],
    affected_cloud_services: [],
    mitigating_cloud_services: [],
    ai_security_incidents: [],
    ai_services_and_developments: [],
    owasp_top_10: ["Injection"],
    title: "US names Chinese man alleged to have exploited Sophos 0-day",
    article_text_md_original: "The US Departments of Treasury and Justice have named a Chinese business...",
    links_original: ["CVE-2020-12271: https://www.tenable.com/cve/CVE-2020-12271"],
    vendor: "Sophos",
    malware_names: []
  },
  {
    url: "https://example.com/article2",
    s3_path_html: "example/2024/11/article2.html",
    s3_path_llm_result: "example/2024/11/article2_llm_result.json",
    domain_folder: "example",
    file_name: "2024_11_01_ransomware_attack",
    article_type: "Ransomware",
    article_date: "2024-11-01",
    sectors: ["Healthcare", "Finance"],
    threat_types: ["Ransomware", "DataExfiltration"],
    threat_actor_type: "Cybercriminal",
    threat_actor_name: ["LockBit"],
    compliance: ["HIPAA", "GDPR"],
    threat_sophistication_level: "Medium",
    attack_vectors: ["Email", "RDP"],
    targeted_assets: ["Data(PII,Financial)", "Infrastructure(Servers,Networks)"],
    severity_level: "High",
    regions: ["Europe", "NorthAmerica"],
    services_impacted: ["Database", "FileServer"],
    products_impacted: ["Windows Server"],
    mitigation_actions: ["Patch", "BackupRestore"],
    affected_organizations: ["HealthcareOrg1"],
    environment: "Hybrid",
    mitre_attack_tactics: ["InitialAccess", "Exfiltration"],
    cve_identifiers: ["CVE-2024-1234"],
    threat_intelligence_source_types: ["SecurityVendors"],
    threat_intelligence_source_names: ["CrowdStrike"],
    financial_impact_estimate: "Major($1,000,000-$10,000,000)",
    financial_impact_estimate_in_article: true,
    related_incidents: [],
    lessons_learned: ["Importance of regular backups"],
    summary: "Major ransomware attack affecting healthcare organizations",
    ciso_summary_key_points: ["Ransomware via RDP exploitation"],
    ciso_summary_actionable_takeaways: ["Implement MFA on all RDP endpoints"],
    cloud_platforms: ["AWS"],
    affected_cloud_services: ["EC2"],
    mitigating_cloud_services: ["AWS Backup"],
    ai_security_incidents: [],
    ai_services_and_developments: [],
    owasp_top_10: [],
    title: "Healthcare Ransomware Attack Analysis",
    article_text_md_original: "A major ransomware attack...",
    links_original: [],
    vendor: "Microsoft",
    malware_names: ["LockBit3.0"]
  },
  {
    url: "https://example.com/article3",
    s3_path_html: "example/2024/10/article3.html",
    s3_path_llm_result: "example/2024/10/article3_llm_result.json",
    domain_folder: "example",
    file_name: "2024_10_15_supply_chain_attack",
    article_type: "SupplyChainAttack",
    article_date: "2024-10-15",
    sectors: ["Technology"],
    threat_types: ["SupplyChainCompromise"],
    threat_actor_type: "Nation-State",
    threat_actor_name: ["APT29"],
    compliance: [],
    threat_sophistication_level: "High",
    attack_vectors: ["SupplyChain"],
    targeted_assets: ["Software"],
    severity_level: "Critical",
    regions: ["Global"],
    services_impacted: ["SoftwareSupplyChain"],
    products_impacted: ["SolarWinds"],
    mitigation_actions: ["VendorAudit"],
    affected_organizations: [],
    environment: "Cloud",
    mitre_attack_tactics: ["SupplyChainCompromise"],
    cve_identifiers: [],
    threat_intelligence_source_types: ["GovernmentAgencies"],
    threat_intelligence_source_names: ["CISA"],
    financial_impact_estimate: "",
    financial_impact_estimate_in_article: false,
    related_incidents: ["SolarWinds2020"],
    lessons_learned: [],
    summary: "Supply chain attack targeting software vendors",
    ciso_summary_key_points: [],
    ciso_summary_actionable_takeaways: [],
    cloud_platforms: ["Azure"],
    affected_cloud_services: [],
    mitigating_cloud_services: [],
    ai_security_incidents: [],
    ai_services_and_developments: [],
    owasp_top_10: [],
    title: "Supply Chain Attack Investigation",
    article_text_md_original: "Investigation into supply chain...",
    links_original: [],
    vendor: "SolarWinds",
    malware_names: []
  }
];

export const mockMetadata: SearchMetadata = {
  generated_at: "2025-08-14T11:37:17.199014Z",
  last_update: "2025-08-14T11:37:17.199014Z",
  total_articles: 3,
  bucket: "sls-aws-article-processor-html",
  articles: mockArticles
};

// Mock R2 object for testing
export class MockR2Object {
  constructor(private data: any) {}
  
  async json() {
    return this.data;
  }
  
  async text() {
    return JSON.stringify(this.data);
  }
}

// Mock R2 bucket for testing
export class MockR2Bucket {
  private storage = new Map<string, any>();
  
  constructor() {
    // Pre-populate with mock metadata
    this.storage.set('search_metadata.json', mockMetadata);
  }
  
  async get(key: string) {
    const data = this.storage.get(key);
    if (!data) return null;
    return {
      text: async () => JSON.stringify(data),
      json: async () => data
    };
  }
  
  async put(key: string, value: any) {
    this.storage.set(key, value);
  }
}

// Mock environment for testing
export const mockEnv = {
  SEARCH_DATA: new MockR2Bucket()
};