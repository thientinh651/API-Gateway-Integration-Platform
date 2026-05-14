export interface ApiKeyRow {
  id: string;
  name: string;
  key: string;
  isActive: boolean;
  createdAt: string;
  rateLimitPerMinute: number;
}
