export default {
  async fetch(request, env, ctx) {
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    };

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    if (request.method !== "POST") {
      return new Response("Method Not Allowed", { status: 405, headers: corsHeaders });
    }

    try {
      const payload = await request.json();
      const action = payload.action;

      // ---------------------------------------------------------
      // ACTION 1: CREATE PAYMENT (CHIP-IN ASIA)
      // ---------------------------------------------------------
      if (action === 'create_payment') {
        const clientIp = request.headers.get("CF-Connecting-IP");
        if (clientIp) payload.client_ip = clientIp;
        
        // Remove worker-specific fields
        delete payload.action;

        const chipResponse = await fetch("https://gate.chip-in.asia/api/v1/purchases/", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": "Bearer " + env.CHIP_SECRET_KEY
          },
          body: JSON.stringify(payload)
        });

        const data = await chipResponse.json();
        return new Response(JSON.stringify(data), { status: chipResponse.status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      // ---------------------------------------------------------
      // ACTION 2: SEND EMAIL (BREVO)
      // ---------------------------------------------------------
      else if (action === 'send_email') {
        const { user_name, user_email, total_amount, items_purchased, file_name, file_content, sender_email, admin_email } = payload;

        // Use payload emails if provided, otherwise fallback to Env Vars
        const fromEmail = sender_email || env.SENDER_EMAIL || "hello@atlasnovus.co";
        const adminDest = admin_email || env.ADMIN_EMAIL || "admin@atlasnovus.co";

        const emailHtml = `
          <!DOCTYPE html>
          <html>
          <body style="font-family: sans-serif; background-color: #F5F5F7; padding: 40px 20px;">
            <div style="max-w-xl; margin: 0 auto; background: #ffffff; border-radius: 20px; padding: 40px;">
              <h2 style="color: #000; margin-top: 0;">Receipt Received</h2>
              <p><strong>Applicant:</strong> ${user_name} (${user_email})</p>
              <p><strong>Items:</strong> ${items_purchased}</p>
              <p><strong>Amount:</strong> ${total_amount}</p>
              <hr style="border: 0; border-top: 1px solid #eee; margin: 20px 0;">
              <p>We have received your proof of payment. Our team will verify it shortly.</p>
            </div>
          </body>
          </html>
        `;

        const brevoBody = {
          sender: { name: "Atlas Novus", email: fromEmail },
          to: [
            { email: user_email, name: user_name },
            { email: adminDest, name: "Admin" }
          ],
          subject: "Receipt Received: Atlas Novus Workshop",
          htmlContent: emailHtml
        };

        if (file_name && file_content) {
          brevoBody.attachment = [{ name: file_name, content: file_content }];
        }

        const brevoResponse = await fetch("https://api.brevo.com/v3/smtp/email", {
          method: "POST",
          headers: {
            "accept": "application/json",
            "api-key": env.BREVO_API_KEY,
            "content-type": "application/json"
          },
          body: JSON.stringify(brevoBody)
        });

        const responseData = await brevoResponse.json();
        
        if (!brevoResponse.ok) {
           return new Response(JSON.stringify({ error: "Brevo Error", details: responseData }), { status: 500, headers: corsHeaders });
        }

        return new Response(JSON.stringify({ message: "Email sent", id: responseData.messageId }), { status: 200, headers: corsHeaders });
      }

      return new Response("Invalid Action", { status: 400, headers: corsHeaders });

    } catch (error) {
      return new Response(JSON.stringify({ message: "Worker Error", error: error.message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
  },
};
