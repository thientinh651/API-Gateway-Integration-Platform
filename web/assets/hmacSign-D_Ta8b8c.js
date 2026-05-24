function c(t,e,n,o,a){const r=n.trim().toUpperCase();return`${t}
${e}
${r}
${o}
${a??""}`}async function s(t,e){const n=new TextEncoder,o=await crypto.subtle.importKey("raw",n.encode(t),{name:"HMAC",hash:"SHA-256"},!1,["sign"]),a=await crypto.subtle.sign("HMAC",o,n.encode(e));return[...new Uint8Array(a)].map(r=>r.toString(16).padStart(2,"0")).join("")}function u(){return String(Math.floor(Date.now()/1e3))}export{c as buildSigningPayload,s as hmacSha256Hex,u as unixTimestampSecs};
