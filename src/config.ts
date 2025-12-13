export interface UnifiFirewallPlatformConfig {
  unifi: UnifiControllerConfig;
  rules?: UnifiFirewallRuleConfig[];
  includeRuleIndexes?: string[];
  excludeRuleIndexes?: string[];
  hiddenRuleIndexes?: string[];
  customNames?: Record<string, string>;
}

export interface UnifiControllerConfig {
  url: string;
  username?: string;
  password?: string;
  apiKey?: string;
  site: string;
  strictSSL: boolean;
  useLocalCredentials?: boolean;
}

export interface UnifiFirewallRuleConfig {
  id: string;
  name: string;
  inverted: boolean;
}
