// netlify/functions/slack.js
// Proxy for Slack API - posts messages to channels via DealDesk Bot

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return resp(200, "");
  if (event.httpMethod !== "POST") return resp(405, { error: "Method not allowed" });

  let body;
  try { body = JSON.parse(event.body); } catch (e) { return resp(400, { error: "Invalid JSON" }); }

  const { action } = body;
  const token = process.env.SLACK_BOT_TOKEN;
  if (!token) return resp(500, { error: "SLACK_BOT_TOKEN not configured" });

  // Action: list channels
  if (action === "list_channels") {
    try {
      var channels = [];
      var cursor = "";
      do {
        var url = "https://slack.com/api/conversations.list?types=public_channel&limit=200";
        if (cursor) url += "&cursor=" + encodeURIComponent(cursor);
        var r = await fetch(url, { headers: { "Authorization": "Bearer " + token } });
        var j = await r.json();
        if (!j.ok) return resp(500, { error: "Slack API error", details: j.error });
        channels = channels.concat(j.channels.map(function(c) { return { id: c.id, name: c.name }; }));
        cursor = (j.response_metadata && j.response_metadata.next_cursor) || "";
      } while (cursor);
      return resp(200, { channels: channels });
    } catch (e) { return resp(500, { error: e.message }); }
  }

  // Action: send message
  if (action === "send") {
    var { channel, text } = body;
    if (!channel || !text) return resp(400, { error: "Missing channel or text" });
    try {
      // Join channel first (in case bot isn't a member)
      await fetch("https://slack.com/api/conversations.join", {
        method: "POST",
        headers: { "Authorization": "Bearer " + token, "Content-Type": "application/json" },
        body: JSON.stringify({ channel: channel }),
      });
      // Send message
      var r = await fetch("https://slack.com/api/chat.postMessage", {
        method: "POST",
        headers: { "Authorization": "Bearer " + token, "Content-Type": "application/json" },
        body: JSON.stringify({ channel: channel, text: text, unfurl_links: false }),
      });
      var j = await r.json();
      if (!j.ok) return resp(500, { error: "Slack send failed", details: j.error });
      return resp(200, { success: true, channel: channel, ts: j.ts });
    } catch (e) { return resp(500, { error: e.message }); }
  }

  return resp(400, { error: "Unknown action. Use 'list_channels' or 'send'." });
};

function resp(s, b) {
  return { statusCode: s, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Content-Type" }, body: JSON.stringify(b) };
}
