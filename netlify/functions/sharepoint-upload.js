// netlify/functions/sharepoint-upload.js
// Speichert PDF in Supabase Storage + erstellt DB-Eintrag mit status=pending
// MIT Duplikat-Erkennung: gleicher Dateiname oder PDF → kein erneuter Upload

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return resp(200, "");
  if (event.httpMethod !== "POST") return resp(405, { error: "Method not allowed" });

  const secret = process.env.WEBHOOK_SECRET;
  const provided = event.headers["x-webhook-secret"] || event.headers["X-Webhook-Secret"];
  if (secret && provided !== secret) return resp(401, { error: "Unauthorized" });

  let body;
  try { body = JSON.parse(event.body); } catch (e) { return resp(400, { error: "Invalid JSON" }); }

  const { pdf_base64, filename } = body;
  if (!pdf_base64) return resp(400, { error: "Missing pdf_base64" });

  // Nur PDFs akzeptieren
  if (filename && !filename.toLowerCase().endsWith('.pdf')) {
    return resp(200, { success: true, action: "skipped", reason: "Keine PDF-Datei", filename: filename });
  }

  const SB_URL = process.env.SUPABASE_URL;
  const SB_KEY = process.env.SUPABASE_KEY;
  const safeName = Date.now() + "_" + (filename || "upload.pdf").replace(/[^a-zA-Z0-9._-]/g, "_");
  const checkName = (filename || "").trim();

  // ── Duplikat-Check ──
  if (checkName) {
    try {
      // 1. Check pending entries (angebotsnr = filename)
      var dr = await fetch(SB_URL + "/rest/v1/kunden?angebotsnr=eq." + encodeURIComponent(checkName), {
        headers: { "apikey": SB_KEY, "Authorization": "Bearer " + SB_KEY }
      });
      var dd = await dr.json();
      if (dd && dd.length > 0) {
        return resp(200, { success: true, action: "skipped", reason: "Datei bereits vorhanden", filename: checkName, existing_kunde: dd[0].kunde });
      }

      // 2. Check processed entries by pdf_url containing the filename
      var shortName = checkName.replace(/\.pdf$/i, "").substring(0, 40);
      var dr2 = await fetch(SB_URL + "/rest/v1/kunden?pdf_url=like.*" + encodeURIComponent(shortName) + "*", {
        headers: { "apikey": SB_KEY, "Authorization": "Bearer " + SB_KEY }
      });
      var dd2 = await dr2.json();
      if (dd2 && dd2.length > 0) {
        return resp(200, { success: true, action: "skipped", reason: "PDF bereits hochgeladen", filename: checkName, existing_kunde: dd2[0].kunde });
      }
    } catch (e) { console.error("Dup check error:", e); }
  }

  // ── Upload PDF to Supabase Storage ──
  let pdfUrl = null;
  try {
    const pdfBuf = Buffer.from(pdf_base64, "base64");
    const ur = await fetch(SB_URL + "/storage/v1/object/vertraege/" + safeName, {
      method: "POST",
      headers: { "apikey": SB_KEY, "Authorization": "Bearer " + SB_KEY, "Content-Type": "application/pdf" },
      body: pdfBuf,
    });
    if (ur.ok) pdfUrl = safeName;
    else return resp(500, { error: "Storage upload failed", details: await ur.text() });
  } catch (e) { return resp(500, { error: "Storage exception", details: e.message }); }

  // ── Create pending record in DB ──
  const row = {
    kunde: "⏳ Ausstehend",
    angebotsnr: filename || safeName,
    notiz: "pending:" + safeName,
    pdf_url: pdfUrl,
    leistungen: [],
  };

  try {
    const dr = await fetch(SB_URL + "/rest/v1/kunden", {
      method: "POST",
      headers: {
        "apikey": SB_KEY, "Authorization": "Bearer " + SB_KEY,
        "Content-Type": "application/json", "Prefer": "return=minimal"
      },
      body: JSON.stringify([row]),
    });
    if (!dr.ok) return resp(500, { error: "DB error", details: await dr.text() });
  } catch (e) { return resp(500, { error: "DB exception", details: e.message }); }

  return resp(200, { success: true, action: "created", pdf_stored: true, filename: safeName, status: "pending" });
};

function resp(s, b) {
  return { statusCode: s, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Content-Type, X-Webhook-Secret" }, body: JSON.stringify(b) };
}
