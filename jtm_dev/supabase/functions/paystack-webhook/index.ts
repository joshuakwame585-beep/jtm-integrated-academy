import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function safeEqualHex(a: string, b: string): boolean {
  if (!/^[0-9a-f]{128}$/i.test(a) || !/^[0-9a-f]{128}$/i.test(b)) return false;
  let difference = 0;
  for (let i = 0; i < a.length; i++) {
    difference |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return difference === 0;
}

async function verifySignature(rawBody: Uint8Array, signature: string, secret: string) {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-512' },
    false,
    ['sign'],
  );
  const digest = new Uint8Array(await crypto.subtle.sign('HMAC', key, rawBody));
  return safeEqualHex(toHex(digest), signature);
}

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return json({ error: 'Method not allowed.' }, 405);

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    const paystackSecret = Deno.env.get('PAYSTACK_SECRET_KEY');

    // This webhook remains restricted to Test Mode.
    if (!paystackSecret || !paystackSecret.startsWith('sk_test_')) {
      return json({ error: 'Paystack Test Mode is not configured.' }, 503);
    }
    if (!supabaseUrl || !serviceRoleKey) {
      return json({ error: 'The payment service is not configured.' }, 503);
    }

    // Verify the signature against the exact raw request body before parsing JSON.
    const rawBody = new Uint8Array(await req.arrayBuffer());
    const signature = req.headers.get('x-paystack-signature') ?? '';
    const validSignature = await verifySignature(rawBody, signature, paystackSecret);
    if (!validSignature) return json({ error: 'Invalid Paystack signature.' }, 401);

    let event: { event?: unknown; data?: { reference?: unknown } };
    try {
      event = JSON.parse(new TextDecoder().decode(rawBody));
    } catch {
      return json({ error: 'Invalid JSON payload.' }, 400);
    }

    // Acknowledge other event types without changing JTM payment records.
    if (event.event !== 'charge.success') return json({ received: true });

    const reference = typeof event.data?.reference === 'string'
      ? event.data.reference.trim()
      : '';
    if (!/^JTM_[a-f0-9]{32}$/i.test(reference)) return json({ received: true });

    const admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: payment, error: paymentError } = await admin
      .from('payments')
      .select('id, student_id, course_id, reference, amount_pesewas, currency, status')
      .eq('reference', reference)
      .maybeSingle();

    if (paymentError) throw paymentError;
    // Ignore valid Paystack transactions that do not belong to a JTM payment.
    if (!payment) return json({ received: true });

    // Confirm the transaction directly with Paystack; never trust the webhook payload alone.
    const verifyResponse = await fetch(
      `https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`,
      { headers: { Authorization: `Bearer ${paystackSecret}` } },
    );
    const verifyResult = await verifyResponse.json();
    if (!verifyResponse.ok || !verifyResult.status || !verifyResult.data) {
      return json({ error: 'Could not verify the transaction with Paystack.' }, 502);
    }

    const transaction = verifyResult.data;
    const metadata = transaction.metadata ?? {};
    if (
      transaction.status !== 'success' ||
      transaction.reference !== payment.reference ||
      Number(transaction.amount) !== Number(payment.amount_pesewas) ||
      transaction.currency !== payment.currency ||
      metadata.student_id !== payment.student_id ||
      metadata.course_id !== payment.course_id
    ) {
      console.error('Webhook transaction details did not match JTM payment:', reference);
      return json({ received: true, processed: false });
    }

    const paidAt = typeof transaction.paid_at === 'string' &&
      !Number.isNaN(Date.parse(transaction.paid_at))
      ? new Date(transaction.paid_at).toISOString()
      : new Date().toISOString();

    const { error: updateError } = await admin
      .from('payments')
      .update({
        status: 'success',
        paystack_transaction_id: String(transaction.id),
        paid_at: paidAt,
        updated_at: new Date().toISOString(),
      })
      .eq('id', payment.id);

    if (updateError) throw updateError;

    const { error: enrollmentError } = await admin
      .from('enrollments')
      .upsert({
        student_id: payment.student_id,
        course_id: payment.course_id,
        status: 'active',
      }, { onConflict: 'student_id,course_id' });

    if (enrollmentError) throw enrollmentError;

    return json({ received: true, processed: true });
  } catch (error) {
    console.error('paystack-webhook error:', error);
    return json({ error: 'Webhook processing failed.' }, 500);
  }
});
