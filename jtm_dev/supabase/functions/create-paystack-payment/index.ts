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
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: cors });
  }
  if (req.method !== 'POST') {
    return json({ error: 'Method not allowed.' }, 405);
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    const paystackSecret = Deno.env.get('PAYSTACK_SECRET_KEY');
    const callbackUrl =
      Deno.env.get('JTM_PAYMENT_CALLBACK_URL') ??
      'https://joshtechmedia.xyz/lms';

    if (!supabaseUrl || !anonKey || !serviceRoleKey) {
      return json({ error: 'The payment service is not configured.' }, 503);
    }

    // This first release is deliberately restricted to Paystack Test Mode.
    if (!paystackSecret || !paystackSecret.startsWith('sk_test_')) {
      return json({
        error: 'Test Mode is not configured. Ask the authorized account holder to add the Paystack test secret in Supabase Function Secrets.',
      }, 503);
    }

    const authorization = req.headers.get('Authorization') ?? '';
    if (!authorization.startsWith('Bearer ')) {
      return json({ error: 'Please sign in before starting payment.' }, 401);
    }

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authorization } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: userData, error: authError } = await userClient.auth.getUser();

    if (authError || !userData.user?.email) {
      return json({ error: 'Your session is invalid. Please sign in again.' }, 401);
    }

    let body: { course_id?: unknown };
    try {
      body = await req.json();
    } catch {
      return json({ error: 'A valid JSON request is required.' }, 400);
    }

    const courseId = typeof body.course_id === 'string'
      ? body.course_id
      : '';
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(courseId)) {
      return json({ error: 'A valid course ID is required.' }, 400);
    }

    const admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: course, error: courseError } = await admin
      .from('courses')
      .select('id, title, access, price, published')
      .eq('id', courseId)
      .maybeSingle();

    if (courseError || !course || !course.published) {
      return json({ error: 'This course is not available for purchase.' }, 404);
    }
    if (course.access !== 'premium') {
      return json({ error: 'This course does not require a premium payment.' }, 400);
    }

    const price = Number(course.price);
    const amountPesewas = Math.round(price * 100);
    if (!Number.isFinite(price) || price <= 0 ||
        !Number.isSafeInteger(amountPesewas) ||
        Math.abs(price * 100 - amountPesewas) > 0.000001) {
      return json({ error: 'The course price is invalid. Ask an administrator to review it.' }, 400);
    }

    const { data: existingEnrollment, error: enrollmentError } = await admin
      .from('enrollments')
      .select('id, status')
      .eq('student_id', userData.user.id)
      .eq('course_id', courseId)
      .maybeSingle();

    if (enrollmentError) throw enrollmentError;
    if (existingEnrollment?.status === 'active' ||
        existingEnrollment?.status === 'completed') {
      return json({ error: 'You already have access to this course.' }, 409);
    }

    const reference = `JTM_${crypto.randomUUID().replaceAll('-', '')}`;

    const { error: paymentInsertError } = await admin
      .from('payments')
      .insert({
        student_id: userData.user.id,
        course_id: courseId,
        reference,
        amount_pesewas: amountPesewas,
        currency: 'GHS',
        gateway: 'paystack',
        status: 'pending',
      });

    if (paymentInsertError) throw paymentInsertError;

    const paystackResponse = await fetch(
      'https://api.paystack.co/transaction/initialize',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${paystackSecret}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          email: userData.user.email,
          amount: amountPesewas,
          currency: 'GHS',
          reference,
          callback_url: callbackUrl,
          metadata: {
            student_id: userData.user.id,
            course_id: course.id,
            course_title: course.title,
          },
        }),
      },
    );

    const paystackResult = await paystackResponse.json();

    if (!paystackResponse.ok || !paystackResult.status ||
        !paystackResult.data?.authorization_url) {
      await admin.from('payments')
        .update({ status: 'failed', updated_at: new Date().toISOString() })
        .eq('reference', reference);

      return json({
        error: 'Paystack could not start this test payment. Please try again later.',
      }, 502);
    }

    return json({
      authorization_url: paystackResult.data.authorization_url,
      reference,
      course_title: course.title,
      amount_pesewas: amountPesewas,
      currency: 'GHS',
    });
  } catch (error) {
    console.error('create-paystack-payment error:', error);
    return json({ error: 'The payment could not be started. Please try again.' }, 500);
  }
});
