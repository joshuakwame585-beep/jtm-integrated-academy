import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': 'https://joshtechmedia.xyz',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Vary': 'Origin',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  });

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'Method not allowed.' }, 405);

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    const paystackSecret = Deno.env.get('PAYSTACK_SECRET_KEY');

    if (!supabaseUrl || !anonKey || !serviceRoleKey) {
      return json({ error: 'The payment service is not configured.' }, 503);
    }

    // Keep this release restricted to Paystack Test Mode.
    if (!paystackSecret || !paystackSecret.startsWith('sk_test_')) {
      return json({ error: 'Paystack Test Mode is not configured.' }, 503);
    }

    const authorization = req.headers.get('Authorization') ?? '';
    if (!authorization.startsWith('Bearer ')) {
      return json({ error: 'Please sign in before verifying payment.' }, 401);
    }

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authorization } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: userData, error: authError } = await userClient.auth.getUser();
    if (authError || !userData.user) {
      return json({ error: 'Your session is invalid. Please sign in again.' }, 401);
    }

    let body: { reference?: unknown };
    try {
      body = await req.json();
    } catch {
      return json({ error: 'A valid JSON request is required.' }, 400);
    }

    const reference = typeof body.reference === 'string' ? body.reference.trim() : '';
    if (!/^JTM_[a-f0-9]{32}$/i.test(reference)) {
      return json({ error: 'A valid JTM payment reference is required.' }, 400);
    }

    const admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    // A student can only verify a payment record belonging to their own account.
    const { data: payment, error: paymentError } = await admin
      .from('payments')
      .select('id, student_id, course_id, reference, amount_pesewas, currency, status')
      .eq('reference', reference)
      .eq('student_id', userData.user.id)
      .maybeSingle();

    if (paymentError) throw paymentError;
    if (!payment) return json({ error: 'Payment record not found.' }, 404);

    // Never trust the browser callback. Ask Paystack directly using the server secret.
    const verifyResponse = await fetch(
      `https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`,
      { headers: { Authorization: `Bearer ${paystackSecret}` } },
    );
    const verifyResult = await verifyResponse.json();

    if (!verifyResponse.ok || !verifyResult.status || !verifyResult.data) {
      return json({ error: 'Paystack could not verify this payment yet. Please try again.' }, 502);
    }

    const transaction = verifyResult.data;
    const metadata = transaction.metadata ?? {};

    if (transaction.reference !== payment.reference ||
        Number(transaction.amount) !== Number(payment.amount_pesewas) ||
        transaction.currency !== payment.currency ||
        metadata.student_id !== payment.student_id ||
        metadata.course_id !== payment.course_id) {
      console.error('Paystack verification mismatch for reference:', reference);
      return json({ error: 'The payment details could not be matched. Please contact JTM support.' }, 409);
    }

    if (transaction.status !== 'success') {
      if (['failed', 'abandoned'].includes(transaction.status)) {
        const { error: updateError } = await admin
          .from('payments')
          .update({ status: 'failed', updated_at: new Date().toISOString() })
          .eq('id', payment.id)
          .neq('status', 'success');
        if (updateError) throw updateError;
      }
      return json({
        success: false,
        payment_status: transaction.status,
        message: 'Payment has not been confirmed as successful.',
      }, 200);
    }

    // Record success, then grant course access. Repeated calls are safe.
    const { error: successError } = await admin
      .from('payments')
      .update({
        status: 'success',
        paystack_transaction_id: String(transaction.id),
        updated_at: new Date().toISOString(),
      })
      .eq('id', payment.id);

    if (successError) throw successError;

    const { error: enrollmentError } = await admin
      .from('enrollments')
      .upsert({
        student_id: payment.student_id,
        course_id: payment.course_id,
        status: 'active',
      }, { onConflict: 'student_id,course_id' });

    if (enrollmentError) {
      console.error('Payment verified but enrollment activation failed:', enrollmentError);
      return json({
        success: false,
        payment_status: 'success',
        error: 'Payment is confirmed, but course access could not be activated yet. Please contact JTM support.',
      }, 500);
    }

    return json({
      success: true,
      payment_status: 'success',
      course_id: payment.course_id,
      message: 'Payment verified. Your premium course is now active.',
    });
  } catch (error) {
    console.error('verify-paystack-payment error:', error);
    return json({ error: 'Payment verification failed. Please try again.' }, 500);
  }
});
