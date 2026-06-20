-- Generated contract PDFs (Zoho Office Integrator merge) linked to SF opportunities

CREATE TABLE IF NOT EXISTS integration_documents (
    id BIGSERIAL PRIMARY KEY,
    tenant_id BIGINT NOT NULL DEFAULT 1 REFERENCES tenants(id),
    sf_entity_type TEXT NOT NULL DEFAULT 'opportunity',
    sf_id TEXT NOT NULL,
    zoho_project_id TEXT,
    filename TEXT NOT NULL,
    content_type TEXT NOT NULL DEFAULT 'application/pdf',
    storage_path TEXT NOT NULL,
    file_size BIGINT NOT NULL DEFAULT 0,
    source_provider TEXT NOT NULL DEFAULT 'zoho_office',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (tenant_id, sf_entity_type, sf_id, source_provider)
);

CREATE INDEX IF NOT EXISTS idx_integration_documents_tenant_sf
    ON integration_documents (tenant_id, sf_id);
