
/* JTM DIGITAL ACADEMY
   Student and administrator portal.
   Supabase: authentication, database and existing media.
   DBByte: new video and PDF uploads through Cloudflare Worker.
*/

(() => {
  'use strict';

  // --------------------------------
  // CONFIGURATION
  // --------------------------------

  const $ = selector => document.querySelector(selector);
  const $$ = selector => [...document.querySelectorAll(selector)];

  const cfg = window.JTM_CONFIG || {};

  const url = String(cfg.SUPABASE_URL || '').trim();
  const key = String(cfg.SUPABASE_ANON_KEY || '').trim();

  const configured = Boolean(
    url &&
    key &&
    !/YOUR[_-]|PLACEHOLDER|example\.supabase/i.test(url) &&
    !/YOUR[_-]|PLACEHOLDER/i.test(key)
  );

  const sb = configured && window.supabase
    ? window.supabase.createClient(url, key)
    : null;

  // Existing Supabase media bucket.
  const STORAGE_BUCKET = 'course-media';

  // Cloudflare Worker connected to DBByte.
  const STORAGE_API =
    'https://jtm-storage-api.kwamejoshua703.workers.dev';

  // DBByte Free plan limit.
  const MAX_FILE_SIZE = 100 * 1024 * 1024;

  const state = {
    user: null,
    role: 'student',
    courses: [],
    enrollments: [],
    progress: [],
    filter: 'all',
    paymentReturnHandled: false
  };

  // --------------------------------
  // GENERAL HELPERS
  // --------------------------------

  function esc(value) {
    return String(value ?? '').replace(/[&<>"']/g, ch => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    })[ch]);
  }

  function showMessage(selector, text, error = false) {
    const element = $(selector);

    if (!element) return;

    element.textContent = text;
    element.classList.toggle('error', error);
  }

  function toast(text) {
    const element = $('#toast');

    if (!element) return;

    element.textContent = text;
    element.classList.add('show');

    window.setTimeout(() => {
      element.classList.remove('show');
    }, 2800);
  }

  function setBusy(button, busy, busyText) {
    if (!button) return;

    if (busy) {
      if (!button.disabled) {
        button.dataset.oldText = button.textContent;
      }

      button.disabled = true;
      button.textContent = busyText || 'Please wait…';
    } else {
      button.disabled = false;

      if (button.dataset.oldText) {
        button.textContent = button.dataset.oldText;
        delete button.dataset.oldText;
      }
    }
  }

  function showTab(tab) {
    if (
      (tab === 'manage' || tab === 'students') &&
      state.role !== 'admin'
    ) {
      tab = 'overview';
    }

    $$('.tab').forEach(button => {
      button.classList.toggle(
        'active',
        button.dataset.tab === tab
      );
    });

    $$('.tab-content').forEach(panel => {
      panel.hidden = panel.id !== `tab-${tab}`;
    });

    const lessonView = $('#lessonView');

    if (lessonView) {
      lessonView.hidden = true;
    }

    if (tab === 'overview') renderOverview();
    if (tab === 'catalogue') renderCatalogue();
    if (tab === 'mycourses') renderMyCourses();
    if (tab === 'manage') renderAdminCourses();
    if (tab === 'students') loadStudents();
  }

  function openApp() {
    $('#welcome').hidden = true;
    $('#authPanel').hidden = true;
    $('#appPanel').hidden = false;
    $('#lessonView').hidden = true;

    const admin = state.role === 'admin';

    $('#dashEyebrow').textContent =
      admin ? 'ACADEMY ADMINISTRATION' : 'YOUR LEARNING';

    $('#dashTitle').textContent =
      admin ? 'Administrator dashboard' : 'Student dashboard';

    $('#dashSubtitle').textContent = state.user?.email || '';

    $$('.admin-only').forEach(element => {
      element.hidden = !admin;
    });

    showTab('overview');
  }

  function closeApp() {
    state.user = null;
    state.role = 'student';
    state.courses = [];
    state.enrollments = [];
    state.progress = [];

    $('#appPanel').hidden = true;
    $('#lessonView').hidden = true;
    $('#welcome').hidden = false;
    $('#authPanel').hidden = false;
    $('#authPassword').value = '';

    showMessage('#authMessage', '');
  }

  // --------------------------------
  // SUPABASE AUTHENTICATION
  // --------------------------------

  async function identifyRole() {
    const { data, error } = await sb
      .from('admin_users')
      .select('user_id')
      .eq('user_id', state.user.id)
      .maybeSingle();

    if (error) throw error;

    state.role = data ? 'admin' : 'student';
  }

  async function loadRemote() {
    await identifyRole();

    const [coursesResult, enrollmentsResult] =
      await Promise.all([
        sb.from('courses')
          .select('*')
          .order('created_at', { ascending: false }),

        sb.from('enrollments')
          .select('*')
          .order('enrolled_at', { ascending: false })
      ]);

    if (coursesResult.error) throw coursesResult.error;
    if (enrollmentsResult.error) throw enrollmentsResult.error;

    state.courses = coursesResult.data || [];
    state.enrollments = enrollmentsResult.data || [];

    const enrollmentIds = state.enrollments.map(
      row => row.id
    );

    if (enrollmentIds.length) {
      const progressResult = await sb
        .from('lesson_progress')
        .select('*')
        .in('enrollment_id', enrollmentIds);

      if (progressResult.error) {
        throw progressResult.error;
      }

      state.progress = progressResult.data || [];
    } else {
      state.progress = [];
    }

    $('#connectionStatus').textContent = 'Connected';

    openApp();
  }

  async function refreshData() {
    try {
      await loadRemote();
      toast('Dashboard refreshed.');
    } catch (error) {
      toast(error.message || 'Could not refresh data.');
    }
  }

  async function getAccessToken() {
    const { data, error } = await sb.auth.getSession();

    if (error) throw error;

    const token = data.session?.access_token;

    if (!token) {
      throw new Error('Please sign in again.');
    }

    return token;
  }

  // --------------------------------
  // PAYSTACK TEST PAYMENTS
  // --------------------------------

  async function startPremiumPayment(courseId, button) {
    const course = state.courses.find(item => item.id === courseId);

    if (!course || course.access !== 'premium') {
      toast('This is not a premium course.');
      return;
    }

    if (Number(course.price) <= 0) {
      toast('Ask the administrator to set a valid course price.');
      return;
    }

    setBusy(button, true, 'Starting secure checkout…');

    try {
      const { data, error } = await sb.functions.invoke(
        'create-paystack-payment',
        { body: { course_id: courseId } }
      );

      if (error) throw error;
      if (!data?.authorization_url) {
        throw new Error(data?.error || 'Paystack did not return a checkout link.');
      }

      window.location.assign(data.authorization_url);
    } catch (error) {
      toast(error.message || 'Could not start payment.');
      setBusy(button, false);
    }
  }

  async function verifyPaymentReturn() {
    if (state.paymentReturnHandled || !sb) return;

    const params = new URLSearchParams(window.location.search);
    const reference = params.get('reference') || params.get('trxref');

    if (!reference) return;

    state.paymentReturnHandled = true;
    toast('Checking your payment with Paystack…');

    try {
      const { data, error } = await sb.functions.invoke(
        'verify-paystack-payment',
        { body: { reference } }
      );

      if (error) throw error;

      if (data?.success === true) {
        params.delete('reference');
        params.delete('trxref');
        const query = params.toString();
        const cleanUrl = window.location.pathname +
          (query ? `?${query}` : '') +
          window.location.hash;
        window.history.replaceState({}, document.title, cleanUrl);

        await loadRemote();
        showTab('mycourses');
        toast('Payment confirmed. Your course is now available.');
      } else {
        state.paymentReturnHandled = false;
        toast(data?.message || 'Payment is not confirmed yet. Refresh and try again shortly.');
      }
    } catch (error) {
      state.paymentReturnHandled = false;
      toast(error.message || 'Could not verify payment. Please try again.');
    }
  }

  // --------------------------------
  // COURSE HELPERS
  // --------------------------------

  function enrolledCourseIds() {
    return new Set(
      state.enrollments
        .filter(row => row.status === 'active')
        .map(row => row.course_id)
    );
  }

  function courseCard(course, myLearning = false) {
    const enrolled = enrolledCourseIds().has(course.id);

    const access = course.access === 'premium'
      ? 'Premium'
      : 'Free';

    let action = '';

    if (myLearning || enrolled) {
      action = `
        <button class="btn primary"
          type="button"
          data-open-course="${esc(course.id)}">
          Open course
        </button>`;
    } else if (course.access === 'free') {
      action = `
        <button class="btn primary"
          type="button"
          data-enrol="${esc(course.id)}">
          Enrol free
        </button>`;
    } else if (course.access === 'premium' && state.role === 'admin') {
      action = `
        <button class="btn primary"
          type="button"
          data-open-course="${esc(course.id)}">
          Preview course
        </button>`;
    } else {
      action = `
        <button class="btn primary"
          type="button"
          data-buy-course="${esc(course.id)}">
          Buy course
        </button>`;
    }

    return `
      <article class="course-card">
        <div class="course-card-top">
          <span class="badge">${esc(access)}</span>
          <span class="muted">
            ${esc(course.level || 'Beginner')}
          </span>
        </div>

        <h3>${esc(course.title)}</h3>
        <p>${esc(course.description || '')}</p>

        <div class="course-meta">
          <span>${esc(course.category || 'General')}</span>

          ${Number(course.price) > 0
            ? `<span>GHS ${Number(course.price).toFixed(2)}</span>`
            : ''}
        </div>

        <div class="course-actions">${action}</div>
      </article>`;
  }

  function renderOverview() {
    const active = state.enrollments.filter(
      row => row.status === 'active'
    );

    const published = state.courses.filter(
      course => course.published
    );

    const completed = state.progress.filter(
      row => row.completed
    ).length;

    $('#stats').innerHTML = `
      <div class="stat-card">
        <span>Available courses</span>
        <strong>${published.length}</strong>
      </div>

      <div class="stat-card">
        <span>My active courses</span>
        <strong>${active.length}</strong>
      </div>

      <div class="stat-card">
        <span>Lessons completed</span>
        <strong>${completed}</strong>
      </div>`;

    const myCourses = state.courses
      .filter(course =>
        active.some(enrollment =>
          enrollment.course_id === course.id
        )
      )
      .slice(0, 3);

    $('#continueList').innerHTML = myCourses.length
      ? myCourses.map(course => courseCard(course, true)).join('')
      : '<p class="muted">You have not enrolled in a course yet. Visit the course catalogue to get started.</p>';
  }

  function renderCatalogue() {
    let courses = state.courses.filter(
      course => course.published || state.role === 'admin'
    );

    if (state.filter !== 'all') {
      courses = courses.filter(
        course => course.access === state.filter
      );
    }

    $('#catalogueGrid').innerHTML = courses.length
      ? courses.map(course => courseCard(course)).join('')
      : '<p class="muted">No courses match this filter yet.</p>';
  }

  function renderMyCourses() {
    const ids = enrolledCourseIds();

    const courses = state.courses.filter(
      course => ids.has(course.id)
    );

    $('#myCourseGrid').innerHTML = courses.length
      ? courses.map(course => courseCard(course, true)).join('')
      : '<p class="muted">Your enrolled courses will appear here.</p>';
  }

  async function enrol(courseId) {
    const course = state.courses.find(
      item => item.id === courseId
    );

    if (!course || course.access !== 'free') return;

    const { error } = await sb.from('enrollments').insert({
      student_id: state.user.id,
      course_id: courseId,
      status: 'active'
    });

    if (error) {
      toast(error.message);
      return;
    }

    toast('You are enrolled.');

    await loadRemote();
    showTab('mycourses');
  }

  // --------------------------------
  // OPEN COURSE AND LESSONS
  // --------------------------------

  async function openCourse(courseId) {
    const course = state.courses.find(
      item => item.id === courseId
    );

    if (!course) return;

    const enrolled = enrolledCourseIds().has(course.id);

    if (
      course.access === 'premium' &&
      state.role !== 'admin' &&
      !enrolled
    ) {
      toast('This premium course is not available yet.');
      return;
    }

    const { data: modules, error: moduleError } = await sb
      .from('modules')
      .select('*')
      .eq('course_id', courseId)
      .order('position');

    if (moduleError) {
      toast(moduleError.message);
      return;
    }

    const moduleIds = (modules || []).map(
      row => row.id
    );

    let lessons = [];

    if (moduleIds.length) {
      const result = await sb
        .from('lessons')
        .select('*')
        .in('module_id', moduleIds)
        .order('position');

      if (result.error) {
        toast(result.error.message);
        return;
      }

      lessons = result.data || [];
    }

    $('#lessonView').innerHTML = `
      <button class="text-btn"
        type="button"
        id="backToLearning">
        ← Back to dashboard
      </button>

      <p class="eyebrow">
        ${esc(course.category || 'COURSE')}
      </p>

      <h2>${esc(course.title)}</h2>
      <p>${esc(course.description || '')}</p>

      ${
        modules.length
          ? modules.map(module => {
              const items = lessons.filter(
                lesson => lesson.module_id === module.id
              );

              return `
                <div class="module-block">
                  <h3>${esc(module.title)}</h3>

                  ${
                    items.length
                      ? items.map(lesson => {
                          const done = state.progress.some(
                            progress =>
                              progress.lesson_id === lesson.id &&
                              progress.completed
                          );

                          return `
                            <button class="lesson-link"
                              type="button"
                              data-lesson="${esc(lesson.id)}"
                              data-course="${esc(courseId)}">

                              <span>
                                ${done ? '✓' : '○'}
                                ${esc(lesson.title)}
                              </span>

                              <small>
                                ${esc(lesson.duration || 'Self-paced')}
                              </small>
                            </button>`;
                        }).join('')
                      : '<p class="muted">Lessons will be added soon.</p>'
                  }
                </div>`;
            }).join('')
          : '<p class="muted">The course content has not been added yet.</p>'
      }

      <div id="lessonContent"></div>`;

    $('#appPanel').hidden = true;
    $('#lessonView').hidden = false;
  }

  // --------------------------------
  // SUPABASE + DBBYTE MEDIA ACCESS
  // --------------------------------

  /*
    Existing Supabase paths contain slashes.
    New DBByte filenames are stored as plain filenames.

    This lets old course materials continue working.
  */

  async function getMediaUrl(path, lessonId, type) {
    if (!path) return null;

    // OLD FILE: retrieve from Supabase Storage.
    if (path.includes('/')) {
      const { data, error } = await sb.storage
        .from(STORAGE_BUCKET)
        .createSignedUrl(path, 3600);

      if (error) throw error;

      return data.signedUrl;
    }

    // NEW FILE: retrieve through the Cloudflare Worker.
    const token = await getAccessToken();

    const response = await fetch(
      `${STORAGE_API}/media-url`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          lessonId,
          type
        })
      }
    );

    const result = await response.json();

    if (!response.ok) {
      throw new Error(
        result.error || 'Could not access lesson media.'
      );
    }

    if (!result.url) {
      throw new Error('The media URL was not returned.');
    }

    return result.url;
  }

  // --------------------------------
  // MEDIA VALIDATION
  // --------------------------------

  function validateMedia(file, type) {
    if (!file || file.size === 0) return;

    if (file.size > MAX_FILE_SIZE) {
      throw new Error(
        'File is too large. Maximum size is 100 MB.'
      );
    }

    const extension = file.name
      .split('.')
      .pop()
      .toLowerCase();

    if (type === 'video') {
      const valid =
        ['mp4', 'webm', 'mov'].includes(extension) &&
        [
          'video/mp4',
          'video/webm',
          'video/quicktime'
        ].includes(file.type);

      if (!valid) {
        throw new Error(
          'Choose an MP4, WebM or MOV video file.'
        );
      }
    }

    if (type === 'pdf') {
      if (
        extension !== 'pdf' ||
        file.type !== 'application/pdf'
      ) {
        throw new Error('Choose a valid PDF file.');
      }
    }
  }

  // --------------------------------
  // UPLOAD NEW MEDIA TO DBBYTE
  // --------------------------------

  async function uploadMedia(file, courseId, moduleId, type) {
    if (!file || file.size === 0) return null;

    validateMedia(file, type);

    const token = await getAccessToken();

    const form = new FormData();

    form.append('file', file, file.name);
    form.append('courseId', courseId);
    form.append('moduleId', moduleId);

    // The Worker expects "resource" for PDF files.
    form.append(
      'type',
      type === 'pdf' ? 'resource' : type
    );

    const response = await fetch(
      `${STORAGE_API}/upload`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`
        },
        body: form
      }
    );

    const result = await response.json();

    if (!response.ok) {
      throw new Error(
        result.error || 'DBByte upload failed.'
      );
    }

    if (!result.path) {
      throw new Error(
        'The upload succeeded but no file path was returned.'
      );
    }

    return result.path;
  }

  /*
    DBByte deletion is not enabled in the current bucket permissions.
    This function intentionally does not attempt Supabase deletion.
  */

  async function removeUploadedMedia(paths) {
    if (paths && paths.length) {
      console.warn(
        'DBByte files may remain if saving the lesson failed. ' +
        'Deletion has not been enabled.'
      );
    }
  }

  // --------------------------------
  // OPEN LESSON WITH VIDEO AND PDF
  // --------------------------------

  async function openLesson(lessonId, courseId) {
    const { data: lesson, error } = await sb
      .from('lessons')
      .select('*')
      .eq('id', lessonId)
      .single();

    if (error) {
      toast(error.message);
      return;
    }

    let videoUrl = null;
    let pdfUrl = null;

    try {
      if (lesson.video_path) {
        videoUrl = await getMediaUrl(
          lesson.video_path,
          lesson.id,
          'video'
        );
      }

      if (lesson.resource_path) {
        pdfUrl = await getMediaUrl(
          lesson.resource_path,
          lesson.id,
          'resource'
        );
      }
    } catch (mediaError) {
      toast(
        `Could not load course material: ${mediaError.message}`
      );
      return;
    }

    const videoSection = videoUrl
      ? `
        <section class="lesson-media">
          <h4>Lesson video</h4>

          <div class="video-frame">
            <video controls
              playsinline
              preload="metadata">
              <source src="${esc(videoUrl)}">
              Your browser does not support video playback.
            </video>
          </div>
        </section>`
      : '';

    const pdfSection = pdfUrl
      ? `
        <section class="lesson-media pdf-resource">
          <h4>Reading material</h4>

          <iframe
            class="pdf-frame"
            src="${esc(pdfUrl)}"
            title="${esc(lesson.title)} reading material"
            loading="lazy">
          </iframe>

          <a class="resource-link"
            href="${esc(pdfUrl)}"
            target="_blank"
            rel="noopener noreferrer">
            Open PDF in a new tab
          </a>
        </section>`
      : '';

    $('#lessonContent').innerHTML = `
      <div class="lesson-content">
        <h3>${esc(lesson.title)}</h3>

        <div class="lesson-body">
          ${esc(
            lesson.body ||
            'No reading material has been added yet.'
          ).replace(/\n/g, '<br>')}
        </div>

        ${videoSection}
        ${pdfSection}

        <button class="btn primary"
          type="button"
          id="completeLessonBtn"
          data-lesson="${esc(lesson.id)}"
          data-course="${esc(courseId)}">
          Mark lesson as complete
        </button>
      </div>`;

    $('#lessonContent').scrollIntoView({
      behavior: 'smooth',
      block: 'start'
    });
  }

  // --------------------------------
  // LESSON PROGRESS
  // --------------------------------

  async function completeLesson(lessonId, courseId) {
    const enrollment = state.enrollments.find(
      row =>
        row.course_id === courseId &&
        row.status === 'active'
    );

    if (!enrollment) {
      toast('Enrol in this course first.');
      return;
    }

    const existing = state.progress.find(
      row =>
        row.enrollment_id === enrollment.id &&
        row.lesson_id === lessonId
    );

    let result;

    if (existing) {
      result = await sb
        .from('lesson_progress')
        .update({
          completed: true,
          completed_at: new Date().toISOString()
        })
        .eq('id', existing.id);
    } else {
      result = await sb
        .from('lesson_progress')
        .insert({
          enrollment_id: enrollment.id,
          lesson_id: lessonId,
          completed: true,
          completed_at: new Date().toISOString()
        });
    }

    if (result.error) {
      toast(result.error.message);
      return;
    }

    toast('Lesson marked as complete.');

    await loadRemote();
    await openCourse(courseId);
  }

  // --------------------------------
  // ADMIN COURSE MANAGEMENT
  // --------------------------------

  function renderAdminCourses() {
    const courses = state.courses;

    $('#adminCourseList').innerHTML = courses.length
      ? courses.map(course => `
          <div class="admin-course-row">
            <div>
              <strong>${esc(course.title)}</strong>

              <small>
                ${course.published ? 'Published' : 'Draft'}
                · ${esc(course.access)}
              </small>
            </div>

            <button class="btn secondary"
              type="button"
              data-edit-course="${esc(course.id)}">
              Manage
            </button>
          </div>
        `).join('')
      : '<p class="muted">No courses created yet.</p>';
  }

  async function editCourse(courseId) {
    if (state.role !== 'admin') return;

    const course = state.courses.find(
      item => item.id === courseId
    );

    if (!course) return;

    const editor = $('#courseEditor');

    editor.hidden = false;
    editor.dataset.courseId = courseId;

    editor.innerHTML = `
      <p class="eyebrow">COURSE CONTENT</p>
      <h3>${esc(course.title)}</h3>

      <button class="btn secondary"
        type="button"
        id="togglePublish">
        ${course.published
          ? 'Unpublish course'
          : 'Publish course'}
      </button>

      <form id="moduleForm" class="stack-form">
        <h4>Add a module</h4>

        <label>Module title
          <input name="title"
            required
            maxlength="140"
            placeholder="e.g. Introduction">
        </label>

        <button class="btn primary" type="submit">
          Add module
        </button>
      </form>

      <div id="moduleManager">
        <p class="muted">Loading modules…</p>
      </div>`;

    editor.scrollIntoView({
      behavior: 'smooth',
      block: 'start'
    });

    $('#togglePublish').addEventListener(
      'click',
      async () => {
        const { error } = await sb
          .from('courses')
          .update({
            published: !course.published
          })
          .eq('id', courseId);

        if (error) {
          toast(error.message);
          return;
        }

        toast('Course publication updated.');

        await loadRemote();
        showTab('manage');
        await editCourse(courseId);
      }
    );

    $('#moduleForm').addEventListener(
      'submit',
      async event => {
        event.preventDefault();

        const form = event.currentTarget;

        const title = new FormData(form)
          .get('title')
          .toString()
          .trim();

        const { error } = await sb
          .from('modules')
          .insert({
            course_id: courseId,
            title
          });

        if (error) {
          toast(error.message);
          return;
        }

        form.reset();

        toast('Module added.');

        await renderModuleManager(courseId);
      }
    );

    await renderModuleManager(courseId);
  }

  // --------------------------------
  // ADMIN MODULE AND LESSON MANAGER
  // --------------------------------

  async function renderModuleManager(courseId) {
    const target = $('#moduleManager');

    if (!target) return;

    const { data: modules, error } = await sb
      .from('modules')
      .select('*')
      .eq('course_id', courseId)
      .order('position');

    if (error) {
      target.textContent = error.message;
      return;
    }

    if (!modules || !modules.length) {
      target.innerHTML =
        '<p class="muted">No modules yet.</p>';
      return;
    }

    const { data: lessons, error: lessonError } = await sb
      .from('lessons')
      .select('*')
      .in(
        'module_id',
        modules.map(module => module.id)
      )
      .order('position');

    if (lessonError) {
      target.textContent = lessonError.message;
      return;
    }

    const lessonRows = lessons || [];

    target.innerHTML = modules.map(module => `
      <div class="module-admin">
        <h4>${esc(module.title)}</h4>

        <form class="lessonForm stack-form"
          data-module-id="${esc(module.id)}">

          <label>Lesson title
            <input name="title"
              required
              maxlength="140"
              placeholder="Lesson title">
          </label>

          <label>Lesson reading content
            <textarea name="body"
              rows="4"
              placeholder="Write lesson notes here"></textarea>
          </label>

          <label>Duration
            <input name="duration"
              value="Self-paced"
              maxlength="50">
          </label>

          <label>Upload lesson video
            <input
              type="file"
              name="videoFile"
              accept="video/mp4,video/webm,video/quicktime">
          </label>

          <small class="muted">
            Supported formats: MP4, WebM and MOV.
            Maximum 100 MB.
          </small>

          <label>Upload PDF reading material
            <input
              type="file"
              name="resourceFile"
              accept="application/pdf,.pdf">
          </label>

          <small class="muted">
            PDF files only. Maximum 100 MB.
          </small>

          <button class="btn secondary" type="submit">
            Add lesson
          </button>
        </form>

        <ul>
          ${
            lessonRows
              .filter(lesson =>
                lesson.module_id === module.id
              )
              .map(lesson => `
                <li>
                  ${esc(lesson.title)}
                  ${lesson.video_path ? ' · Video' : ''}
                  ${lesson.resource_path ? ' · PDF' : ''}
                </li>
              `).join('') ||
              '<li class="muted">No lessons yet.</li>'
          }
        </ul>
      </div>
    `).join('');

    $$('.lessonForm').forEach(form => {
      form.addEventListener(
        'submit',
        async event => {
          event.preventDefault();

          if (state.role !== 'admin') {
            toast('Administrator access is required.');
            return;
          }

          const fd = new FormData(form);

          const button = form.querySelector(
            'button[type="submit"]'
          );

          const title = String(
            fd.get('title') || ''
          ).trim();

          const body = String(
            fd.get('body') || ''
          );

          const duration = String(
            fd.get('duration') || 'Self-paced'
          );

          const videoFile = fd.get('videoFile');
          const resourceFile = fd.get('resourceFile');

          if (!title) {
            toast('Enter a lesson title.');
            return;
          }

          const uploadedPaths = [];

          setBusy(button, true, 'Uploading lesson…');

          try {
            // Validate both files before uploading either.
            validateMedia(videoFile, 'video');
            validateMedia(resourceFile, 'pdf');

            const moduleId = form.dataset.moduleId;

            let videoPath = null;
            let resourcePath = null;

            if (videoFile && videoFile.size > 0) {
              videoPath = await uploadMedia(
                videoFile,
                courseId,
                moduleId,
                'video'
              );

              uploadedPaths.push(videoPath);
            }

            if (resourceFile && resourceFile.size > 0) {
              resourcePath = await uploadMedia(
                resourceFile,
                courseId,
                moduleId,
                'pdf'
              );

              uploadedPaths.push(resourcePath);
            }

            const { error: insertError } = await sb
              .from('lessons')
              .insert({
                module_id: moduleId,
                title,
                body,
                duration,
                video_path: videoPath,
                resource_path: resourcePath,
                published: true
              });

            if (insertError) {
              throw insertError;
            }

            toast(
              'Lesson and learning materials added successfully.'
            );

            await renderModuleManager(courseId);

          } catch (error) {
            await removeUploadedMedia(uploadedPaths);

            let message =
              error.message || 'Could not add lesson.';

            if (uploadedPaths.length) {
              message +=
                ' An uploaded DBByte file may remain in your bucket.';
            }

            toast(message);

          } finally {
            setBusy(button, false);
          }
        }
      );
    });
  }

  // --------------------------------
  // ADMIN STUDENT RECORDS
  // --------------------------------

  async function loadStudents() {
    if (state.role !== 'admin') return;

    const target = $('#studentTable');

    if (!target) return;

    target.innerHTML =
      '<p class="muted">Loading student records…</p>';

    const [profilesResult, enrollmentsResult] =
      await Promise.all([
        sb.from('profiles')
          .select('id,email,display_name,created_at')
          .order('created_at', { ascending: false }),

        sb.from('enrollments')
          .select('student_id,course_id,status')
      ]);

    if (profilesResult.error) {
      target.textContent = profilesResult.error.message;
      return;
    }

    if (enrollmentsResult.error) {
      target.textContent = enrollmentsResult.error.message;
      return;
    }

    const profiles = profilesResult.data || [];
    const enrollments = enrollmentsResult.data || [];

    target.innerHTML = profiles.length
      ? `
        <table class="student-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Email</th>
              <th>Enrolments</th>
              <th>Joined</th>
            </tr>
          </thead>

          <tbody>
            ${profiles.map(profile => `
              <tr>
                <td>
                  ${esc(profile.display_name || 'Student')}
                </td>

                <td>${esc(profile.email || '')}</td>

                <td>
                  ${enrollments.filter(row =>
                    row.student_id === profile.id &&
                    row.status === 'active'
                  ).length}
                </td>

                <td>
                  ${profile.created_at
                    ? new Date(
                        profile.created_at
                      ).toLocaleDateString()
                    : ''}
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>`
      : '<p class="muted">No student profiles have registered yet.</p>';
  }

  // --------------------------------
  // SIGN IN
  // --------------------------------

  $('#authForm').addEventListener(
    'submit',
    async event => {
      event.preventDefault();

      if (!sb) {
        showMessage(
          '#authMessage',
          'Supabase is not configured. Check your project URL and publishable/anon key in config.js.',
          true
        );
        return;
      }

      const button = $('#signInBtn');

      setBusy(button, true, 'Signing in…');

      const email = $('#authEmail').value.trim();
      const password = $('#authPassword').value;

      try {
        const { data, error } = await sb.auth
          .signInWithPassword({
            email,
            password
          });

        if (error) throw error;

        state.user = data.user;

        await loadRemote();
        await verifyPaymentReturn();

        showMessage('#authMessage', '');

      } catch (error) {
        showMessage(
          '#authMessage',
          error.message,
          true
        );

      } finally {
        setBusy(button, false);
      }
    }
  );

  // --------------------------------
  // STUDENT REGISTRATION
  // --------------------------------

  $('#signUpBtn').addEventListener(
    'click',
    async () => {
      if (!sb) {
        showMessage(
          '#authMessage',
          'Supabase is not configured. Check config.js first.',
          true
        );
        return;
      }

      const email = $('#authEmail').value.trim();
      const password = $('#authPassword').value;

      if (!email || password.length < 6) {
        showMessage(
          '#authMessage',
          'Enter a valid email address and a password of at least 6 characters.',
          true
        );
        return;
      }

      const button = $('#signUpBtn');

      setBusy(button, true, 'Creating account…');

      try {
        const { data, error } = await sb.auth.signUp({
          email,
          password,
          options: {
            data: {
              display_name: email.split('@')[0]
            }
          }
        });

        if (error) throw error;

        if (data.session && data.user) {
          state.user = data.user;

          await loadRemote();

          toast('Your student account is ready.');

        } else {
          showMessage(
            '#authMessage',
            'Your account was created, but Supabase has not started a session. Check Authentication → Sign In / Providers → Email and turn off Confirm email if you want immediate sign-in.'
          );
        }

      } catch (error) {
        showMessage(
          '#authMessage',
          error.message,
          true
        );

      } finally {
        setBusy(button, false);
      }
    }
  );

  // --------------------------------
  // SIGN OUT
  // --------------------------------

  $('#signOutBtn').addEventListener(
    'click',
    async () => {
      if (sb) {
        const { error } = await sb.auth.signOut();

        if (error) {
          toast(error.message);
          return;
        }
      }

      closeApp();
    }
  );

  $('#refreshBtn').addEventListener(
    'click',
    refreshData
  );

  // --------------------------------
  // DASHBOARD NAVIGATION
  // --------------------------------

  $('#tabs').addEventListener(
    'click',
    event => {
      const button = event.target.closest('[data-tab]');

      if (button) {
        showTab(button.dataset.tab);
      }
    }
  );

  // --------------------------------
  // OTHER BUTTONS
  // --------------------------------

  document.addEventListener(
    'click',
    async event => {
      const goto = event.target.closest('[data-goto]');

      if (goto) {
        showTab(goto.dataset.goto);
        return;
      }

      const filter = event.target.closest(
        '[data-course-filter]'
      );

      if (filter) {
        state.filter = filter.dataset.courseFilter;

        $$('.filter').forEach(button => {
          button.classList.toggle(
            'active',
            button === filter
          );
        });

        renderCatalogue();
        return;
      }

      const enrolButton = event.target.closest(
        '[data-enrol]'
      );

      if (enrolButton) {
        await enrol(enrolButton.dataset.enrol);
        return;
      }

      const buyButton = event.target.closest(
        '[data-buy-course]'
      );

      if (buyButton) {
        await startPremiumPayment(
          buyButton.dataset.buyCourse,
          buyButton
        );
        return;
      }

      const openButton = event.target.closest(
        '[data-open-course]'
      );

      if (openButton) {
        await openCourse(openButton.dataset.openCourse);
        return;
      }

      const editButton = event.target.closest(
        '[data-edit-course]'
      );

      if (editButton && state.role === 'admin') {
        await editCourse(editButton.dataset.editCourse);
        return;
      }

      const lessonButton = event.target.closest(
        '[data-lesson]'
      );

      if (lessonButton) {
        await openLesson(
          lessonButton.dataset.lesson,
          lessonButton.dataset.course
        );
        return;
      }

      const completeButton = event.target.closest(
        '#completeLessonBtn'
      );

      if (completeButton) {
        await completeLesson(
          completeButton.dataset.lesson,
          completeButton.dataset.course
        );
        return;
      }

      if (event.target.closest('#backToLearning')) {
        $('#lessonView').hidden = true;
        $('#appPanel').hidden = false;

        showTab('mycourses');
      }
    }
  );

  // --------------------------------
  // CREATE COURSE
  // --------------------------------

  $('#courseForm').addEventListener(
    'submit',
    async event => {
      event.preventDefault();

      if (state.role !== 'admin') return;

      const form = event.currentTarget;
      const fd = new FormData(form);

      const button = form.querySelector(
        'button[type="submit"]'
      );

      setBusy(button, true, 'Creating…');

      try {
        const { error } = await sb
          .from('courses')
          .insert({
            title: String(fd.get('title')).trim(),
            description: String(
              fd.get('description')
            ).trim(),
            access: String(fd.get('access')),
            level: String(fd.get('level')),
            category: String(
              fd.get('category') || 'General'
            ).trim() || 'General',
            price: Number(fd.get('price') || 0),
            published: fd.get('published') === 'on',
            created_by: state.user.id
          });

        if (error) throw error;

        form.reset();
        form.elements.price.value = '0';

        showMessage(
          '#courseMessage',
          'Course created successfully.'
        );

        await loadRemote();
        showTab('manage');

      } catch (error) {
        showMessage(
          '#courseMessage',
          error.message,
          true
        );

      } finally {
        setBusy(button, false);
      }
    }
  );

  // --------------------------------
  // INITIAL SETUP
  // --------------------------------

  $('#year').textContent = new Date().getFullYear();

  $('#connectionStatus').textContent =
    configured ? 'Supabase configured' : 'Not connected';

  if (!sb) {
    showMessage(
      '#authMessage',
      'Add your Supabase project URL and publishable/anon key to config.js to connect the portal.'
    );
  } else {
    sb.auth.getSession().then(
      async ({ data, error }) => {
        if (error) {
          showMessage(
            '#authMessage',
            error.message,
            true
          );
          return;
        }

        if (data.session?.user) {
          state.user = data.session.user;

          try {
            await loadRemote();
            await verifyPaymentReturn();
          } catch (err) {
            showMessage(
              '#authMessage',
              `Could not load your dashboard: ${err.message}`,
              true
            );
          }
        }
      }
    );
  }

})();
