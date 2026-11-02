import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers: { ...cors, 'Content-Type': 'application/json' } });
  try {
    const url = Deno.env.get('SUPABASE_URL')!;
    const anon = Deno.env.get('SUPABASE_ANON_KEY')!;
    const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const authHeader = req.headers.get('Authorization') || '';
    const userClient = createClient(url, anon, { global: { headers: { Authorization: authHeader } } });
    const { data: userData, error: authError } = await userClient.auth.getUser();
    if (authError || !userData.user) return new Response(JSON.stringify({ error: 'Sign in is required.' }), { status: 401, headers: { ...cors, 'Content-Type': 'application/json' } });
    const { course_id } = await req.json();
    if (!course_id) return new Response(JSON.stringify({ error: 'course_id is required.' }), { status: 400, headers: { ...cors, 'Content-Type': 'application/json' } });
    const admin = createClient(url, service);
    const { data: course, error: ce } = await admin.from('courses').select('id,title,access').eq('id', course_id).single();
    if (ce || !course || course.access !== 'premium') throw new Error('Certificates are only available for eligible premium courses.');
    const { data: enrollment, error: ee } = await admin.from('enrollments').select('id,status').eq('course_id', course_id).eq('student_id', userData.user.id).eq('status', 'active').single();
    if (ee || !enrollment) throw new Error('An active premium enrolment is required.');
    const { data: modules, error: me } = await admin.from('modules').select('id,lessons(id)').eq('course_id', course_id);
    if (me) throw me;
    const lessonIds = (modules || []).flatMap((m: any) => (m.lessons || []).map((l: any) => l.id));
    if (!lessonIds.length) throw new Error('This course has no published lessons yet.');
    const { data: progress, error: pe } = await admin.from('lesson_progress').select('lesson_id').eq('enrollment_id', enrollment.id).eq('completed', true).in('lesson_id', lessonIds);
    if (pe) throw pe;
    const completed = new Set((progress || []).map((p: any) => p.lesson_id));
    if (lessonIds.some((lessonId: string) => !completed.has(lessonId))) throw new Error('Complete every course lesson before requesting your certificate.');
    const { data: existing } = await admin.from('certificates').select('certificate_code,issued_at').eq('student_id', userData.user.id).eq('course_id', course_id).maybeSingle();
    if (existing) return new Response(JSON.stringify({ certificate_code: existing.certificate_code, issued_at: existing.issued_at, course_title: course.title }), { headers: { ...cors, 'Content-Type': 'application/json' } });
    const { data: cert, error: certError } = await admin.from('certificates').insert({ student_id: userData.user.id, course_id }).select('certificate_code,issued_at').single();
    if (certError) throw certError;
    return new Response(JSON.stringify({ certificate_code: cert.certificate_code, issued_at: cert.issued_at, course_title: course.title }), { headers: { ...cors, 'Content-Type': 'application/json' } });
  } catch (error) {
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : 'Certificate request failed.' }), { status: 400, headers: { ...cors, 'Content-Type': 'application/json' } });
  }
});
