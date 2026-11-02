# JTM Integrated Academy — V5

This package contains the JTM public website and an integrated LMS portal. It is a deployable starter release with a working browser-only demo and a Supabase connection scaffold. **Do not treat demo data as real student data.**

## What is included

- `index.html`: JTM public landing page, portfolio, services and course catalogue.
- `lms.html`: student/admin portal interface.
- `lms.js` and `lms.css`: course catalogue, demo dashboards, course/module/lesson/quiz authoring, lesson navigation, progress, and certificate preview.
- `supabase/schema.sql`: database tables, row-level security policies, admin membership, free-course enrolment rules and private course-media storage bucket.
- `supabase/seed-starter-courses.sql`: optional sample catalogue with three free starter courses and three unpublished premium course placeholders.
- `supabase/functions/issue-certificate/index.ts`: server-side premium certificate eligibility check and issuance function.
- `config.example.js`: Supabase browser configuration template.
- `config.js`: currently a safe placeholder; no private keys are included.

## 1. Preview first

1. Extract the ZIP.
2. Open the `jtm_dev` folder.
3. Open `index.html` for the public website.
4. Open `lms.html` and choose **Student preview** or **Admin preview**.
5. Demo changes are saved only in that browser's local storage. They are not shared with other people and can be cleared by the browser.

## 2. Connect Supabase (required for real accounts and shared data)

1. Create a Supabase project with help from a trusted adult who can supervise the service account.
2. In Supabase, open **SQL Editor** and run the complete contents of `supabase/schema.sql`.
3. Optionally run `supabase/seed-starter-courses.sql` once to add the sample courses.
4. In Supabase **Project Settings → API**, copy the Project URL and the publishable/anon key.
5. Open `config.js` in a text editor and replace the two placeholder values:

```js
window.JTM_CONFIG = {
  SUPABASE_URL: "https://YOUR-PROJECT.supabase.co",
  SUPABASE_ANON_KEY: "YOUR_PUBLIC_ANON_OR_PUBLISHABLE_KEY"
};
```

The anon/publishable key is designed for browser use when Row Level Security is enabled. **Never put a `service_role` key, database password, or payment secret in `config.js` or any browser file.**

6. Publish the site, then create your own account from the portal.
7. In Supabase **Authentication → Users**, copy your account's user UUID.
8. In SQL Editor, run this once with your own UUID:

```sql
insert into public.admin_users(user_id)
values ('PASTE-YOUR-USER-UUID-HERE');
```

9. Sign out and sign in again. Your account should now see the admin tabs. Do not make other users admins.

## 3. Deploy the certificate function

The function checks the signed-in student, active premium enrolment and completion of every lesson before issuing a certificate. Deploy it with the Supabase CLI from the project folder:

```bash
supabase functions deploy issue-certificate
```

Keep the service-role key only in Supabase's server-side function secrets. Never copy it into `config.js`. If your Supabase project does not already provide `SUPABASE_SERVICE_ROLE_KEY` to Edge Functions, set it using the Supabase secrets command while following the official dashboard/CLI guidance. Test certificate issuance with test accounts before any real use.

## 4. Deploy on Netlify

### Manual deployment
1. Extract the ZIP.
2. Drag the `jtm_dev` folder (the folder containing `index.html`) into Netlify's manual deploy area.

### GitHub deployment
1. Create a private GitHub repository for the source code.
2. Upload the contents of `jtm_dev` to the repository root (not an extra nested folder).
3. In Netlify, choose **Add new site → Import an existing project**, connect GitHub and select the repository.
4. For this static site, leave the build command blank and set the publish directory to `.`.
5. Deploy. For updates, commit/push changes to GitHub and Netlify will redeploy.

## 5. Important current limitations

This is the integrated LMS foundation, not a fully audited commercial learning platform. The preview dashboards and course authoring work in demo mode. Supabase authentication, published-course reads, course creation, module/lesson/quiz creation, private file upload, free enrolment, lesson-progress writes, student listing and the certificate Edge Function are scaffolded for a configured project. Before real students use it, complete end-to-end testing of every Supabase policy and workflow, especially admin deletion, private media playback, student enrolment, quiz grading and certificate issuance.

- Free courses can be enrolled in when Supabase is configured.
- Premium course cards can be published and managed, but premium enrolment and access remain blocked while payments are disabled.
- Paystack/Hubtel are **not connected**. There is no payment collection in this release.
- Demo certificates are clearly marked as previews and are not official. In Supabase mode, the included Edge Function checks premium enrolment and lesson completion before issuing a certificate record. Add a public verification page and have the academy's certificate policy reviewed before presenting certificates as formal credentials.
- Demo student/admin buttons are only for local preview. They are not secure logins and must never be used as real admin access.
- Video/PDF upload is available in the configured Supabase admin workflow. Use appropriately sized, permission-cleared course materials. The storage bucket has a 500 MB per-file limit in the supplied schema; adjust deliberately if needed.
- The current quiz is a practice/knowledge check. Add server-side grading/attempt records and stronger validation before using it for formal assessments.

## 6. Before inviting students

- Ask a trusted adult to supervise account ownership, public contact information and service-provider accounts.
- Add a privacy notice and terms for students, including how accounts and learning records are handled.
- Test sign-up, email confirmation, sign-in, free enrolment, lesson access, progress, admin publishing and storage permissions with test accounts.
- Do not collect sensitive personal data you do not need.
- Do not send passwords, OTPs, Supabase service-role keys or payment secrets to anyone.
