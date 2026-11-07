(() => {
  const $ = (s, root = document) => root.querySelector(s);
  const state = { chatId: null, chats: [], streaming: false, controller: null, theme: localStorage.getItem('rivo-theme') || 'dark', renameId: null };
  const DEFAULT_PROMPT = `You are a highly capable AI assistant and expert software engineer.\n\nYou specialize in Python, JavaScript, HTML, CSS, Linux, networking, cybersecurity education, debugging, and software development.\n\nRespond in the language used by the user.\n\nProvide complete, runnable code when requested.\n\nExplain errors and provide practical fixes.\n\nNever pretend that code was executed when it was not.\n\nBe accurate, concise, and technically helpful.\n\nSupport authorized cybersecurity labs, defensive security, and educational penetration testing.`;
  const el = {
    sidebar: $('#sidebar'), scrim: $('#sidebar-scrim'), list: $('#chat-list'), welcome: $('#welcome'), messages: $('#messages'), input: $('#prompt-input'), form: $('#composer-form'), send: $('#send-button'), toast: $('#toast'),
    settingsModal: $('#settings-modal'), renameModal: $('#rename-modal'), prompt: $('#system-prompt')
  };

  function setTheme(theme) {
    state.theme = theme;
    document.documentElement.classList.toggle('light-theme', theme === 'light');
    localStorage.setItem('rivo-theme', theme);
    const dark = $('#hl-theme-dark'), light = $('#hl-theme-light');
    if (dark && light) { dark.disabled = theme === 'light'; light.disabled = theme !== 'light'; }
  }
  setTheme(state.theme);

  function setLanguage(language) {
    state.language = language;
    localStorage.setItem('rivo-language', language);
    document.documentElement.lang = language === 'bn' ? 'bn' : 'en';
    const bn = language === 'bn';
    const text = (selector, value) => { const node = $(selector); if (node) node.textContent = value; };
    text('#language-toggle', bn ? 'EN' : 'বাংলা');
    text('#new-chat span:nth-child(2)', bn ? 'নতুন চ্যাট' : 'New chat');
    text('#history-label', bn ? 'আপনার চ্যাট' : 'YOUR CHATS');
    text('#privacy-label', bn ? 'ব্যক্তিগত ও স্ব-হোস্টেড' : 'Private & self-hosted');
    text('.profile-label strong', bn ? 'রিভো এআই' : 'Rivo AI');
    text('.profile-label small', bn ? 'সেটিংস ও পছন্দ' : 'Settings & preferences');
    text('.eyebrow', bn ? 'আপনার ব্যক্তিগত এআই কর্মক্ষেত্র' : 'YOUR PRIVATE AI WORKSPACE');
    const heading = $('#welcome h1'); if (heading) heading.innerHTML = bn ? 'আপনি কী <br class="mobile-break">তৈরি করতে <span>চান?</span>' : 'What can I help<br class="mobile-break"> you <span>build?</span>';
    text('.welcome-copy', bn ? 'ভাবনা, কোড এবং আরও অনেক কিছুর জন্য আপনার সহায়ক এআই।' : 'A thoughtful assistant for ideas, code, and everything in between.');
    const cards = $$('.suggestion');
    const labels = bn ? [['কোডের সমস্যা ঠিক করুন','সমস্যা খুঁজে সমাধান করুন'],['ওয়েবের জন্য কিছু তৈরি করুন','সাইট বা অ্যাপ একসাথে পরিকল্পনা করুন'],['কঠিন বিষয় বুঝে নিন','জটিল বিষয় সহজভাবে জানুন']] : [['Debug some code','Find the issue and fix it'],['Build something for the web','Plan a site or app together'],['Explain a tricky topic','Make the complex feel simple']];
    const prompts = bn ? ['আমার একটি পাইথন স্ক্রিপ্ট ডিবাগ করতে সাহায্য করুন। কোড ও ত্রুটিটি দেব।','একটি রেসপনসিভ ওয়েবসাইট পরিকল্পনা ও তৈরি করতে সাহায্য করুন।','একটি প্রযুক্তিগত বিষয় সহজভাবে ব্যবহারিক উদাহরণসহ বুঝিয়ে দিন।'] : ['Help me debug a Python script. I will paste the code and error.','Help me plan and build a responsive website. Ask me what it should do.','Explain a technical topic clearly, with a practical example.'];
    cards.forEach((card, i) => { const strong = $('strong', card), small = $('small', card); if (strong) strong.textContent = labels[i][0]; if (small) small.textContent = labels[i][1]; card.dataset.prompt = prompts[i]; });
    text('#model-state', state.modelStatus === true ? (bn ? 'চ্যাটের জন্য প্রস্তুত' : 'Ready to chat') : state.modelStatus === false ? (bn ? 'মডেল অনুপলব্ধ' : 'Model unavailable') : (bn ? 'মডেল যাচাই হচ্ছে…' : 'Checking model…'));
    el.input.placeholder = bn ? 'রিভো এআই-কে বার্তা লিখুন…' : 'Message Rivo AI…';
    text('.composer-hint', bn ? 'পাঠাতে Enter · নতুন লাইনের জন্য Shift + Enter' : 'Enter to send · Shift + Enter for a new line');
    text('.disclaimer', bn ? 'রিভো এআই ভুল করতে পারে। গুরুত্বপূর্ণ তথ্য যাচাই করুন।' : 'Rivo AI can make mistakes. Check important information.');
    text('.modal-heading .eyebrow', bn ? 'আপনার কর্মক্ষেত্র সাজান' : 'PERSONALIZE YOUR SPACE');
    text('#settings-title', bn ? 'সেটিংস' : 'Settings');
    text('label[for="system-prompt"]', bn ? 'সিস্টেম প্রম্পট' : 'System prompt');
    text('.field-help', bn ? 'সহকারীর ভূমিকা ও উত্তরের ধরন নির্ধারণ করুন। এটি সব কথোপকথনে প্রযোজ্য হবে।' : "Set the assistant's role and response style. This applies to all conversations.");
    text('#reset-prompt', bn ? 'ডিফল্টে ফিরুন' : 'Restore default');
    const settingsButtons = el.settingsModal.querySelectorAll('.modal-actions button');
    if (settingsButtons[0]) settingsButtons[0].textContent = bn ? 'বাতিল' : 'Cancel';
    if (settingsButtons[1]) settingsButtons[1].textContent = bn ? 'পরিবর্তন সংরক্ষণ' : 'Save changes';
    text('#rename-title', bn ? 'চ্যাটের নাম বদলান' : 'Rename chat');
    text('label[for="rename-input"]', bn ? 'কথোপকথনের নাম' : 'Conversation name');
    const loginHeading = $('.login-card h1'); if (loginHeading) loginHeading.textContent = bn ? 'আবার স্বাগতম।' : 'Welcome back.';
    text('.login-card>p:not(.eyebrow)', bn ? 'চালিয়ে যেতে আপনার অ্যাক্সেস পাসওয়ার্ড লিখুন।' : 'Enter your access password to continue.');
    text('#login-password', '');
    const pass = $('#login-password'); if (pass) pass.placeholder = bn ? 'অ্যাক্সেস পাসওয়ার্ড' : 'Access password';
    const loginButton = $('.login-submit'); if (loginButton) loginButton.firstChild.textContent = bn ? 'ওয়ার্কস্পেস খুলুন ' : 'Unlock workspace ';
  }
  state.language = localStorage.getItem('rivo-language') || 'en';
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

  async function api(url, options = {}) {
    const headers = new Headers(options.headers || {});
    if (options.body && !(options.body instanceof FormData)) headers.set('Content-Type', 'application/json');
    headers.set('X-Requested-With', 'RivoAI');
    let response;
    try { response = await fetch(url, { ...options, headers, credentials: 'same-origin' }); }
    catch (_) { throw new Error('Unable to reach the server. Check your connection and try again.'); }
    if (response.status === 401 && !url.includes('/auth/')) { showLogin(); throw new Error('Your session has expired. Please sign in again.'); }
    if (!response.ok) {
      let detail = `Request failed (${response.status}).`;
      try { const body = await response.json(); detail = body.detail || detail; } catch (_) {}
      throw new Error(detail);
    }
    return response;
  }
  function toast(message) {
    el.toast.textContent = message; el.toast.classList.add('show');
    clearTimeout(toast.timer); toast.timer = setTimeout(() => el.toast.classList.remove('show'), 2600);
  }
  function closeSidebar() { el.sidebar.classList.remove('open'); el.scrim.classList.remove('show'); }
  function openSidebar() { el.sidebar.classList.add('open'); el.scrim.classList.add('show'); }
  function showLogin() { $('#login-screen').hidden = false; setTimeout(() => $('#login-password').focus(), 50); }
  function hideLogin() { $('#login-screen').hidden = true; }
  function scrollBottom(force = true) {
    const view = $('#conversation-view');
    if (force || view.scrollHeight - view.scrollTop - view.clientHeight < 170) view.scrollTop = view.scrollHeight;
  }
  function hideWelcome() { el.welcome.style.display = 'none'; el.messages.classList.add('has-messages'); }
  function resetConversation() {
    state.chatId = null; state.streaming = false;
    el.messages.replaceChildren(); el.messages.classList.remove('has-messages'); el.welcome.style.display = '';
    el.input.value = ''; resizeInput(); renderChats(); closeSidebar();
  }
  function safeMarkdown(text) {
    if (window.marked && window.DOMPurify) {
      marked.setOptions({ breaks: true, gfm: true });
      return DOMPurify.sanitize(marked.parse(text || ''), { USE_PROFILES: { html: false } });
    }
    const escaped = (text || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    return escaped.split(/\n\n+/).map(p => `<p>${p.replace(/\n/g, '<br>')}</p>`).join('');
  }
  function addCodeTools(container) {
    container.querySelectorAll('pre').forEach(pre => {
      if (pre.parentElement.classList.contains('code-wrap')) return;
      const code = pre.querySelector('code');
      const langMatch = code?.className.match(/language-([\w#+.-]+)/);
      const label = langMatch ? langMatch[1] : 'Code';
      if (window.hljs && code) {
        try { if (langMatch) hljs.highlightElement(code); else hljs.highlightElement(code); } catch (_) {}
      }
      const wrap = document.createElement('div'); wrap.className = 'code-wrap';
      const head = document.createElement('div'); head.className = 'code-head';
      const lang = document.createElement('span'); lang.textContent = label;
      const copy = document.createElement('button'); copy.type = 'button'; copy.className = 'copy-code'; copy.innerHTML = '<svg viewBox="0 0 24 24"><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3"/></svg><span>Copy code</span>';
      copy.addEventListener('click', async () => { await copyText(code?.innerText || pre.innerText); copy.querySelector('span').textContent = 'Copied!'; setTimeout(() => { if (copy.isConnected) copy.querySelector('span').textContent = 'Copy code'; }, 1400); });
      head.append(lang, copy); pre.replaceWith(wrap); wrap.append(head, pre);
    });
  }
  function renderAssistantContent(contentEl, text) {
    contentEl.innerHTML = safeMarkdown(text);
    addCodeTools(contentEl);
  }
  function createMessage(role, content = '', { pending = false } = {}) {
    const row = document.createElement('article'); row.className = `message ${role}`; row.dataset.role = role;
    if (role === 'assistant') {
      const avatar = document.createElement('div'); avatar.className = 'message-avatar'; avatar.textContent = 'R';
      const body = document.createElement('div'); body.className = 'message-body';
      const contentEl = document.createElement('div'); contentEl.className = 'message-content'; contentEl.dataset.raw = content;
      if (pending) { const typing = document.createElement('div'); typing.className = 'typing'; typing.innerHTML = '<span></span><span></span><span></span>'; contentEl.append(typing); }
      else renderAssistantContent(contentEl, content);
      const actions = document.createElement('div'); actions.className = 'message-actions';
      const copy = document.createElement('button'); copy.type = 'button'; copy.textContent = 'Copy'; copy.addEventListener('click', async () => { await copyText(contentEl.dataset.raw || ''); toast('Response copied'); });
      const regen = document.createElement('button'); regen.type = 'button'; regen.textContent = 'Regenerate'; regen.className = 'regenerate-button'; regen.addEventListener('click', () => regenerate());
      actions.append(copy, regen); body.append(contentEl, actions); row.append(avatar, body);
    } else {
      const body = document.createElement('div'); body.className = 'message-body'; body.textContent = content; row.append(body);
    }
    el.messages.append(row); return row;
  }
  async function copyText(text) {
    try { await navigator.clipboard.writeText(text); }
    catch (_) { const area = document.createElement('textarea'); area.value = text; area.style.position = 'fixed'; area.style.opacity = '0'; document.body.append(area); area.select(); document.execCommand('copy'); area.remove(); }
  }
  async function refreshChats() {
    try { const res = await api('/api/chats'); state.chats = await res.json(); renderChats(); }
    catch (error) { if (!error.message.includes('session')) console.warn(error); }
  }
  function renderChats() {
    el.list.replaceChildren();
    if (!state.chats.length) { const empty = document.createElement('div'); empty.style.cssText = 'padding:10px 8px;color:#777983;font-size:11px'; empty.textContent = state.language === 'bn' ? 'আপনার কথোপকথন এখানে দেখা যাবে' : 'Your conversations will appear here'; el.list.append(empty); return; }
    state.chats.forEach(chat => {
      const item = document.createElement('div'); item.className = `chat-entry${chat.id === state.chatId ? ' active' : ''}`; item.dataset.id = chat.id;
      const glyph = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); glyph.setAttribute('viewBox', '0 0 24 24'); glyph.innerHTML = '<path d="M20 11.5a7.5 7.5 0 0 1-7.5 7.5H5l1.8-3A7.5 7.5 0 1 1 20 11.5Z"/>';
      const title = document.createElement('span'); title.className = 'chat-entry-title'; title.textContent = chat.title;
      const menu = document.createElement('button'); menu.className = 'chat-menu'; menu.textContent = '···'; menu.title = 'Chat options'; menu.setAttribute('aria-label', `Options for ${chat.title}`);
      menu.addEventListener('click', e => { e.stopPropagation(); showChatMenu(chat, menu); });
      item.append(glyph, title, menu); item.addEventListener('click', () => loadChat(chat.id)); el.list.append(item);
    });
  }
  function showChatMenu(chat, anchor) {
    const existing = $('.chat-popover');
    if (existing) { const same = existing.dataset.id === chat.id; existing.remove(); if (same) return; }
    const menu = document.createElement('div'); menu.className = 'chat-popover'; menu.dataset.id = chat.id;
    const rename = document.createElement('button'); rename.type = 'button'; rename.textContent = 'Rename';
    const remove = document.createElement('button'); remove.type = 'button'; remove.textContent = 'Delete'; remove.className = 'delete-action';
    rename.addEventListener('click', e => { e.stopPropagation(); menu.remove(); openRename(chat); });
    remove.addEventListener('click', e => { e.stopPropagation(); menu.remove(); deleteChat(chat.id); });
    menu.append(rename, remove); anchor.closest('.chat-entry').append(menu);
    setTimeout(() => document.addEventListener('click', function dismiss(event) { if (!menu.contains(event.target) && event.target !== anchor) { menu.remove(); document.removeEventListener('click', dismiss); } }, { once: true }), 0);
  }
  async function loadChat(id) {
    if (state.streaming) { toast('Stop the current response before switching chats.'); return; }
    try {
      const res = await api(`/api/chats/${encodeURIComponent(id)}`); const chat = await res.json();
      state.chatId = chat.id; el.messages.replaceChildren(); hideWelcome();
      chat.messages.forEach(msg => createMessage(msg.role, msg.content));
      renderChats(); closeSidebar(); scrollBottom();
    } catch (error) { toast(error.message); }
  }
  async function newChat() {
    if (state.streaming) stopGeneration();
    resetConversation();
    try { await api('/api/chats', { method: 'POST', body: JSON.stringify({ title: 'New chat' }) }).then(async r => { const c = await r.json(); state.chatId = c.id; }); await refreshChats(); }
    catch (error) { toast(error.message); }
    el.input.focus();
  }
  async function deleteChat(id) {
    if (!window.confirm('Delete this conversation? This cannot be undone.')) return;
    try { await api(`/api/chats/${encodeURIComponent(id)}`, { method: 'DELETE' }); if (state.chatId === id) resetConversation(); await refreshChats(); toast('Conversation deleted'); }
    catch (error) { toast(error.message); }
  }
  function openRename(chat) {
    state.renameId = chat.id; $('#rename-input').value = chat.title; el.renameModal.classList.add('open'); el.renameModal.setAttribute('aria-hidden', 'false'); setTimeout(() => $('#rename-input').focus(), 40);
  }
  async function saveRename() {
    const title = $('#rename-input').value.trim(); if (!title || !state.renameId) return;
    try { await api(`/api/chats/${encodeURIComponent(state.renameId)}`, { method: 'PATCH', body: JSON.stringify({ title }) }); el.renameModal.classList.remove('open'); await refreshChats(); toast('Chat renamed'); }
    catch (error) { toast(error.message); }
  }
  async function sendMessage(text, isRegenerate = false) {
    text = text.trim(); if (state.streaming || (!isRegenerate && !text)) return;
    if (!state.chatId) {
      try { const r = await api('/api/chats', { method: 'POST', body: JSON.stringify({ title: 'New chat' }) }); const chat = await r.json(); state.chatId = chat.id; }
      catch (error) { toast(error.message); return; }
    }
    if (!isRegenerate) { hideWelcome(); createMessage('user', text); el.input.value = ''; resizeInput(); }
    else {
      const previous = [...el.messages.querySelectorAll('.message.assistant')].at(-1); if (previous) previous.remove();
    }
    const assistant = createMessage('assistant', '', { pending: true });
    const contentEl = $('.message-content', assistant);
    state.streaming = true; el.send.classList.add('is-streaming'); el.send.setAttribute('aria-label', 'Stop generation');
    state.controller = new AbortController(); scrollBottom();
    try {
      const response = await api(`/api/chats/${encodeURIComponent(state.chatId)}/stream`, { method: 'POST', body: JSON.stringify({ message: isRegenerate ? 'Regenerate the previous answer.' : text, regenerate: isRegenerate }), signal: state.controller.signal });
      const reader = response.body.getReader(); const decoder = new TextDecoder(); let buffer = '', full = '';
      while (true) {
        const { value, done } = await reader.read(); if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const events = buffer.split(/\n\n/); buffer = events.pop() || '';
        for (const event of events) {
          const line = event.split('\n').find(x => x.startsWith('data: ')); if (!line) continue;
          let data; try { data = JSON.parse(line.slice(6)); } catch (_) { continue; }
          if (data.error) { throw new Error(data.error); }
          if (data.token) { full += data.token; contentEl.dataset.raw = full; renderAssistantContent(contentEl, full); scrollBottom(false); }
        }
      }
      if (!full) { contentEl.dataset.raw = ''; contentEl.textContent = 'No response was returned.'; }
      await refreshChats();
    } catch (error) {
      if (error.name === 'AbortError') {
        if (!contentEl.dataset.raw) { assistant.remove(); }
      } else {
        if (!contentEl.dataset.raw) contentEl.textContent = error.message;
        else { const warning = document.createElement('p'); warning.style.color = '#eea07f'; warning.textContent = `\n\nConnection interrupted: ${error.message}`; contentEl.append(warning); }
        toast(error.message);
      }
    } finally {
      state.streaming = false; state.controller = null; el.send.classList.remove('is-streaming'); el.send.setAttribute('aria-label', 'Send message'); el.input.focus(); scrollBottom();
    }
  }
  function stopGeneration() { if (state.controller) state.controller.abort(); }
  async function regenerate() {
    if (state.streaming || !state.chatId) return;
    // Remove the assistant from the client; server-side history removes and replaces it.
    await sendMessage('Regenerate previous answer', true);
  }
  function resizeInput() { el.input.style.height = 'auto'; el.input.style.height = `${Math.min(el.input.scrollHeight, 200)}px`; }
  async function checkModel() {
    try {
      const response = await api('/api/status'); const status = await response.json();
      state.modelStatus = status.ready;
      $('#model-light').className = `model-light ${status.ready ? 'online' : 'offline'}`;
      $('#model-state').textContent = status.ready ? (state.language === 'bn' ? 'চ্যাটের জন্য প্রস্তুত' : 'Ready to chat') : (status.error || (state.language === 'bn' ? 'মডেল অনুপলব্ধ' : 'Model unavailable'));
      $('#model-label').textContent = status.model || 'Qwen model';
    } catch (_) { state.modelStatus = false; $('#model-light').className = 'model-light offline'; $('#model-state').textContent = state.language === 'bn' ? 'স্ট্যাটাস পাওয়া যায়নি' : 'Status unavailable'; }
  }
  async function openSettings() {
    try { const r = await api('/api/settings'); const data = await r.json(); el.prompt.value = data.system_prompt; $('#settings-model').textContent = `Model: ${data.model} · Context: ${data.num_ctx.toLocaleString()} tokens`; $('#save-status').textContent = ''; el.settingsModal.classList.add('open'); el.settingsModal.setAttribute('aria-hidden', 'false'); }
    catch (error) { toast(error.message); }
  }
  async function saveSettings() {
    const button = $('#save-settings'); button.disabled = true;
    try { await api('/api/settings', { method: 'PUT', body: JSON.stringify({ system_prompt: el.prompt.value }) }); $('#save-status').textContent = 'Saved'; toast('Settings saved'); setTimeout(() => el.settingsModal.classList.remove('open'), 350); }
    catch (error) { $('#save-status').textContent = error.message; }
    finally { button.disabled = false; }
  }
  function closeModals() { document.querySelectorAll('.modal-backdrop.open').forEach(m => { m.classList.remove('open'); m.setAttribute('aria-hidden', 'true'); }); }
  async function bootstrap() {
    try {
      const response = await fetch('/api/auth/status', { credentials: 'same-origin' }); const auth = await response.json();
      if (auth.required && !auth.authenticated) { showLogin(); return; }
      hideLogin(); await refreshChats(); await checkModel(); setInterval(checkModel, 60000);
    } catch (_) { $('#model-state').textContent = 'Unable to connect'; }
  }

  $('#new-chat').addEventListener('click', newChat);
  $('#open-sidebar').addEventListener('click', openSidebar); $('#close-sidebar').addEventListener('click', closeSidebar); el.scrim.addEventListener('click', closeSidebar);
  $('#theme-toggle').addEventListener('click', () => setTheme(state.theme === 'dark' ? 'light' : 'dark'));
  $('#language-toggle').addEventListener('click', () => setLanguage(state.language === 'bn' ? 'en' : 'bn'));
  setLanguage(state.language);
  $('#settings-open').addEventListener('click', openSettings); $('#save-settings').addEventListener('click', saveSettings); $('#reset-prompt').addEventListener('click', () => { el.prompt.value = DEFAULT_PROMPT; });
  $('#refresh-chats').addEventListener('click', refreshChats); $('#status-refresh').addEventListener('click', checkModel); $('#save-rename').addEventListener('click', saveRename);
  document.querySelectorAll('[data-close-modal]').forEach(b => b.addEventListener('click', closeModals));
  document.querySelectorAll('.modal-backdrop').forEach(m => m.addEventListener('click', e => { if (e.target === m) closeModals(); }));
  document.addEventListener('keydown', e => { if (e.key === 'Escape') { closeModals(); closeSidebar(); } if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); newChat(); } });
  el.form.addEventListener('submit', e => { e.preventDefault(); if (state.streaming) stopGeneration(); else sendMessage(el.input.value); });
  el.input.addEventListener('input', resizeInput);
  el.input.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); if (state.streaming) stopGeneration(); else sendMessage(el.input.value); } });
  document.querySelectorAll('.suggestion').forEach(b => b.addEventListener('click', () => { el.input.value = b.dataset.prompt || ''; resizeInput(); el.input.focus(); }));
  $('#login-form').addEventListener('submit', async e => {
    e.preventDefault(); const error = $('#login-error'); error.textContent = '';
    try { await api('/api/auth/login', { method: 'POST', body: JSON.stringify({ password: $('#login-password').value }) }); $('#login-password').value = ''; hideLogin(); await bootstrap(); }
    catch (err) { error.textContent = err.message; }
  });
  bootstrap();
})();
