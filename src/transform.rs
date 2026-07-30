//! Canonical schema transformation — Integration Platform core.
//! Maps provider-specific payloads (Salesforce, Zoho) to a unified canonical model.
#![allow(dead_code)]

use serde_json::{Map, Value};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TransformProvider {
    Salesforce,
    ZohoProjects,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TransformEntity {
    Contact,
}

/// Declarative mapping profile for docs, UI, and API.
pub fn transform_profile() -> Value {
    serde_json::json!({
        "engine": "avaso_transform_v1",
        "entities": ["contact"],
        "contact": {
            "canonical": {
                "id": "string — external id",
                "name": "string — display name",
                "email": "string",
                "phone": "string",
                "source": "salesforce | zoho_projects"
            },
            "mappings": [
                {
                    "canonical": "name",
                    "salesforce": ["FirstName", "LastName"],
                    "salesforce_fallback": "Name",
                    "zoho_projects": "name",
                    "zoho_crm_note": "Full_Name (khi dùng Zoho CRM — connector mở rộng)"
                },
                { "canonical": "email", "salesforce": "Email", "zoho_projects": "description (embedded)" },
                { "canonical": "phone", "salesforce": "Phone", "zoho_projects": "description (embedded)" },
                { "canonical": "id", "salesforce": "Id", "zoho_projects": "id" }
            ]
        }
    })
}

fn str_field(v: &Value, key: &str) -> String {
    v.get(key)
        .and_then(|x| x.as_str())
        .unwrap_or("")
        .trim()
        .to_string()
}

fn join_name(first: &str, last: &str) -> String {
    match (first.is_empty(), last.is_empty()) {
        (true, true) => String::new(),
        (false, true) => first.to_string(),
        (true, false) => last.to_string(),
        (false, false) => format!("{first} {last}"),
    }
}

/// Salesforce Contact / Lead record → canonical contact.
pub fn salesforce_to_canonical_contact(record: &Value) -> Value {
    let first = str_field(record, "FirstName");
    let last = str_field(record, "LastName");
    let name = {
        let composed = join_name(&first, &last);
        if composed.is_empty() {
            str_field(record, "Name")
        } else {
            composed
        }
    };
    serde_json::json!({
        "id": str_field(record, "Id"),
        "name": name,
        "email": str_field(record, "Email"),
        "phone": str_field(record, "Phone"),
        "source": "salesforce"
    })
}

/// Canonical contact → Salesforce Contact create/update body.
pub fn canonical_to_salesforce_contact(canonical: &Value) -> Value {
    let name = str_field(canonical, "name");
    let (first, last) = split_display_name(&name);
    let mut out = Map::new();
    if !first.is_empty() {
        out.insert("FirstName".into(), first.into());
    }
    if !last.is_empty() {
        out.insert("LastName".into(), last.into());
    }
    if name.is_empty() {
        if let Some(email) = canonical.get("email").filter(|v| v.is_string()) {
            out.insert("LastName".into(), email.clone());
        }
    }
    let email = str_field(canonical, "email");
    if !email.is_empty() {
        out.insert("Email".into(), email.into());
    }
    let phone = str_field(canonical, "phone");
    if !phone.is_empty() {
        out.insert("Phone".into(), phone.into());
    }
    Value::Object(out)
}

/// Zoho Projects task (or similar) → canonical contact representation.
pub fn zoho_projects_to_canonical_contact(record: &Value) -> Value {
    let name = record
        .get("name")
        .or_else(|| record.get("full_name"))
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .trim()
        .to_string();
    let (email, phone) =
        parse_embedded_contact_meta(record.get("description").and_then(|v| v.as_str()));
    serde_json::json!({
        "id": record.get("id_string")
            .or_else(|| record.get("id"))
            .map(|v| v.to_string().trim_matches('"').to_string())
            .unwrap_or_default(),
        "name": name,
        "email": email,
        "phone": phone,
        "source": "zoho_projects"
    })
}

/// Canonical contact → Zoho Projects task body (demo: contact as follow-up task).
pub fn canonical_to_zoho_projects_task(canonical: &Value) -> Value {
    let name = str_field(canonical, "name");
    let email = str_field(canonical, "email");
    let phone = str_field(canonical, "phone");
    let description = format!(
        "email: {} | phone: {}",
        if email.is_empty() { "—" } else { &email },
        if phone.is_empty() { "—" } else { &phone },
    );
    serde_json::json!({
        "name": if name.is_empty() { "Contact" } else { name.as_str() },
        "description": description
    })
}

fn split_display_name(name: &str) -> (String, String) {
    let parts: Vec<&str> = name.split_whitespace().collect();
    match parts.len() {
        0 => (String::new(), String::new()),
        1 => (parts[0].to_string(), String::new()),
        _ => (parts[0].to_string(), parts[1..].join(" ")),
    }
}

fn parse_embedded_contact_meta(desc: Option<&str>) -> (String, String) {
    let Some(d) = desc else {
        return (String::new(), String::new());
    };
    let mut email = String::new();
    let mut phone = String::new();
    for part in d.split('|') {
        let p = part.trim();
        if let Some(e) = p.strip_prefix("email:") {
            email = e.trim().trim_matches('—').trim().to_string();
        } else if let Some(ph) = p.strip_prefix("phone:") {
            phone = ph.trim().trim_matches('—').trim().to_string();
        }
    }
    (email, phone)
}

/// Transform SF SOQL/query JSON (`records` array) → canonical list response.
pub fn salesforce_query_to_canonical_contacts(body: &[u8]) -> Result<Vec<u8>, String> {
    let parsed: Value = serde_json::from_slice(body).map_err(|e| format!("invalid json: {e}"))?;
    let records = parsed
        .get("records")
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default();
    let contacts: Vec<Value> = records
        .iter()
        .map(salesforce_to_canonical_contact)
        .collect();
    serde_json::to_vec(&serde_json::json!({
        "entity": "contact",
        "format": "canonical",
        "count": contacts.len(),
        "data": contacts
    }))
    .map_err(|e| format!("serialize: {e}"))
}

/// Transform single SF Contact object → canonical.
pub fn salesforce_record_to_canonical_contact_bytes(body: &[u8]) -> Result<Vec<u8>, String> {
    let parsed: Value = serde_json::from_slice(body).map_err(|e| format!("invalid json: {e}"))?;
    let contact = salesforce_to_canonical_contact(&parsed);
    serde_json::to_vec(&serde_json::json!({
        "entity": "contact",
        "format": "canonical",
        "data": contact
    }))
    .map_err(|e| format!("serialize: {e}"))
}

pub fn preview_transform(
    provider: TransformProvider,
    entity: TransformEntity,
    payload: &Value,
) -> Result<Value, String> {
    match (provider, entity) {
        (TransformProvider::Salesforce, TransformEntity::Contact) => {
            Ok(salesforce_to_canonical_contact(payload))
        }
        (TransformProvider::ZohoProjects, TransformEntity::Contact) => {
            Ok(zoho_projects_to_canonical_contact(payload))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sf_first_name_to_canonical_name() {
        let sf = serde_json::json!({"FirstName": "Tinh", "LastName": "", "Email": "a@b.vn"});
        let c = salesforce_to_canonical_contact(&sf);
        assert_eq!(c["name"], "Tinh");
        assert_eq!(c["email"], "a@b.vn");
        assert_eq!(c["source"], "salesforce");
    }

    #[test]
    fn canonical_to_sf_and_back() {
        let canonical = serde_json::json!({
            "name": "Tinh Nguyen",
            "email": "tinh@co.vn",
            "phone": "0901"
        });
        let sf = canonical_to_salesforce_contact(&canonical);
        assert_eq!(sf["FirstName"], "Tinh");
        assert_eq!(sf["LastName"], "Nguyen");
        let back = salesforce_to_canonical_contact(&sf);
        assert_eq!(back["name"], "Tinh Nguyen");
    }

    #[test]
    fn canonical_to_zoho_task_name() {
        let canonical = serde_json::json!({"name": "Tinh", "email": "x@y.z"});
        let task = canonical_to_zoho_projects_task(&canonical);
        assert_eq!(task["name"], "Tinh");
        assert!(task["description"].as_str().unwrap().contains("x@y.z"));
    }

    #[test]
    fn transform_profile_has_mappings() {
        let p = transform_profile();
        assert_eq!(p["entities"][0], "contact");
    }
}
