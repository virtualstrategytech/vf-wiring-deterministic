# Cal.com Booking Template

**Base link (30m, single host):**

**Prefill query params (optional):**

- `name` – visitor name
- `email` – visitor email
- `notes` – text added to the booking
- `hide_event_type_details=true` – cleaner embed
- `theme=dark` – dark theme
- `redirect_url` – where to send user after booking

**Example:**
https://cal.com/YOUR_HANDLE/30min

?name={{first_name}}
&email={{customer_email}}
&notes={{encodeURIComponent(notes_q)}}
&theme=dark
&hide_event_type_details=true
&redirect_url=https%3A%2F%2Fvirtualstrategytech.com%2Fthank-you

**Inline embed (iframe):**

```html
<iframe
  src="https://cal.com/YOUR_HANDLE/30min?theme=dark"
  width="100%"
  height="800"
  frameborder="0"
  allowfullscreen
></iframe>

## You can trigger this from Convocore via the vf:cal:open event or open ##
directly from your site.
```

---

## How to use the Postman file

## Save as webhook/postman_collection.json.

## Import into Postman.

## Set base_url to your local/Render URL.

## If your server validates HMAC, set vf_signing_secret. If not, flip use_hmac to false.

# `webhook/postman_collection.json`

A Postman collection that:

- defines `{{base_url}}` and `{{vf_signing_secret}}` variables,
- computes `X-VF-Signature` via HMAC-SHA256 of the raw body,
- includes **health**, **/webhook**, **/generate_lesson**, **/generate_quiz**, and **/export_lesson**.

> If your service doesn’t require HMAC in dev, set `use_hmac` = `false`.

```json
{
  "info": {
    "name": "vf-webhook-service",
    "_postman_id": "d3f1a6b8-6a8a-4b67-9c60-cc17c8820f21",
    "description": "Smoke + sandbox calls for Voiceflow webhook service.",
    "schema": "https://schema.getpostman.com/json/collection/v2.1.0/collection.json"
  },
  "variable": [
    { "key": "base_url", "value": "https://vf-webhook-service.onrender.com" },
    { "key": "vf_signing_secret", "value": "REPLACE_ME" },
    { "key": "use_hmac", "value": "true" },
    { "key": "last_export_url", "value": "" }
  ],
  "event": [
    {
      "listen": "prerequest",
      "script": {
        "type": "text/javascript",
        "exec": [
          "// Compute X-VF-Signature if enabled",
          "const useHmac = pm.collectionVariables.get('use_hmac') === 'true';",
          "if (!useHmac) { pm.globals.unset('vf_signature'); return; }",
          "const secret = pm.collectionVariables.get('vf_signing_secret') || '';",
          "const body = pm.request.body ? pm.request.body.raw || '' : '';",
          "const sig = CryptoJS.HmacSHA256(body, secret).toString(CryptoJS.enc.Hex);",
          "pm.globals.set('vf_signature', sig);"
        ]
      }
    }
  ],
  "item": [
    {
      "name": "GET /health",
      "request": {
        "method": "GET",
        "url": "{{base_url}}/health"
      },
      "event": [
        {
          "listen": "test",
          "script": {
            "type": "text/javascript",
            "exec": ["pm.test('status 200', () => pm.response.code === 200);"]
          }
        }
      ]
    },
    {
      "name": "POST /webhook (Teach & Quiz orchestrator)",
      "request": {
        "method": "POST",
        "header": [
          { "key": "Content-Type", "value": "application/json" },
          {
            "key": "X-VF-Signature",
            "value": "{{vf_signature}}",
            "disabled": false
          }
        ],
        "url": "{{base_url}}/webhook",
        "body": {
          "mode": "raw",
          "raw": "{\n  \"type\": \"teach_and_quiz\",\n  \"inputs\": {\n    \"first_name\": \"Alex\",\n    \"optimized_question\": \"Create a short lesson on OKR pitfalls for a startup CTO; tone practical; add 5 bullets.\",\n    \"audience\": \"CTO\",\n    \"tone\": \"practical\",\n    \"length\": \"short\",\n    \"examples\": true\n  }\n}\n"
        }
      },
      "event": [
        {
          "listen": "test",
          "script": {
            "type": "text/javascript",
            "exec": [
              "pm.test('status 200', () => pm.response.code === 200);",
              "pm.test('has API_Response', () => !!pm.response.json().API_Response);"
            ]
          }
        }
      ]
    },
    {
      "name": "POST /generate_lesson",
      "request": {
        "method": "POST",
        "header": [
          { "key": "Content-Type", "value": "application/json" },
          { "key": "X-VF-Signature", "value": "{{vf_signature}}" }
        ],
        "url": "{{base_url}}/generate_lesson",
        "body": {
          "mode": "raw",
          "raw": "{\n  \"first_name\": \"Alex\",\n  \"topic\": \"How to choose a pricing model for B2B SaaS\",\n  \"audience\": \"Founder\",\n  \"tone\": \"executive\",\n  \"length\": \"short\",\n  \"examples\": true\n}\n"
        }
      },
      "event": [
        {
          "listen": "test",
          "script": {
            "type": "text/javascript",
            "exec": ["pm.test('status 200', () => pm.response.code === 200);"]
          }
        }
      ]
    },
    {
      "name": "POST /generate_quiz",
      "request": {
        "method": "POST",
        "header": [
          { "key": "Content-Type", "value": "application/json" },
          { "key": "X-VF-Signature", "value": "{{vf_signature}}" }
        ],
        "url": "{{base_url}}/generate_quiz",
        "body": {
          "mode": "raw",
          "raw": "{\n  \"lesson_title\": \"B2B SaaS Pricing 101\",\n  \"counts\": { \"mcq\": 3, \"tf\": 2, \"open\": 1 },\n  \"context\": { \"audience\": \"Founder\", \"difficulty\": \"beginner\" }\n}\n"
        }
      },
      "event": [
        {
          "listen": "test",
          "script": {
            "type": "text/javascript",
            "exec": ["pm.test('status 200', () => pm.response.code === 200);"]
          }
        }
      ]
    },
    {
      "name": "POST /export_lesson",
      "request": {
        "method": "POST",
        "header": [
          { "key": "Content-Type", "value": "application/json" },
          { "key": "X-VF-Signature", "value": "{{vf_signature}}" }
        ],
        "url": "{{base_url}}/export_lesson",
        "body": {
          "mode": "raw",
          "raw": "{\n  \"filename\": \"lesson-okrs-demo\",\n  \"markdown\": \"# Lesson Title\\n\\n- bullet 1\\n- bullet 2\\n\"\n}\n"
        }
      },
      "event": [
        {
          "listen": "test",
          "script": {
            "type": "text/javascript",
            "exec": [
              "pm.test('status 200', () => pm.response.code === 200);",
              "const url = pm.response.json().export_url; pm.collectionVariables.set('last_export_url', url);",
              "pm.test('has export_url', () => !!url);"
            ]
          }
        }
      ]
    }
  ]
}
```
