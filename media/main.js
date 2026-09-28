(function () {
  const vscode = acquireVsCodeApi();
  const persistedUiState = vscode.getState() || {};
  const messagesEl = document.getElementById("messages");
  const formEl = document.getElementById("input-form");
  const inputEl = document.getElementById("input");
  const approvalBanner = document.getElementById("approval-banner");
  const taskListEl = document.getElementById("tasklist");
  const attachmentsBar = document.getElementById("attachments-bar");
  const attachBtn = document.getElementById("attach-btn");
  const attachFolderBtn = document.getElementById("attach-folder-btn");
  const attachTxtMdBtn = document.getElementById("attach-txt-md-btn");
  const attachActiveBtn = document.getElementById("attach-active-btn");
  const sendBtn = document.getElementById("send-btn");
  const stopBtn = document.getElementById("stop-btn");
  const usageInfo = document.getElementById("usage-info");
  const sessionListEl = document.getElementById("session-list");
  const sidebarNewBtn = document.getElementById("sidebar-new-btn");
  const mentionMenu = document.getElementById("mention-menu");
  const chatPane = document.getElementById("chat-pane");
  const sidebarEl = document.getElementById("sidebar");
  let isSidebarCollapsed = persistedUiState.sidebarCollapsed !== false;
  sidebarEl.classList.toggle("collapsed", isSidebarCollapsed);

  const langBtn = document.getElementById("lang-btn");
  const helpBtn = document.getElementById("help-btn");
  const helpModal = document.getElementById("help-modal");
  const closeHelpBtn = document.getElementById("close-help-btn");
  const closeHelpFooterBtn = document.getElementById("close-help-footer-btn");
  const openTgBtn = document.getElementById("open-tg-btn");
  const copyTgBtn = document.getElementById("copy-tg-btn");
  const modalOpenTgBtn = document.getElementById("modal-open-tg-btn");
  const modalCopyTgBtn = document.getElementById("modal-copy-tg-btn");

  const modeAgentBtn = document.getElementById("mode-agent-btn");
  const modeChatBtn = document.getElementById("mode-chat-btn");
  const modePlanBtn = document.getElementById("mode-plan-btn");
  const modelPicker = document.getElementById("model-picker");
  const permissionPicker = document.getElementById("permission-picker");
  const contextPickerBtn = document.getElementById("context-picker-btn");
  const contextPicker = document.getElementById("context-picker");
  const contextUsageBtn = document.getElementById("context-usage-btn");
  const sessionSubtitle = document.getElementById("session-subtitle");
  const sessionStatus = document.getElementById("session-status");
  const sessionStatusText = document.getElementById("session-status-text");
  const sessionMenuBtn = document.getElementById("session-menu-btn");
  const sessionMenu = document.getElementById("session-menu");
  const newActivityBtn = document.getElementById("new-activity-btn");
  const activityFooter = document.getElementById("activity-footer");
  const activityFooterText = document.getElementById("activity-footer-text");
  const activityStopBtn = document.getElementById("activity-stop-btn");
  const contextInspector = document.getElementById("context-inspector");
  const contextInspectorBody = document.getElementById("context-inspector-body");
  const closeContextInspector = document.getElementById("close-context-inspector");
  const toastRegion = document.getElementById("toast-region");
  let currentMode = "agent";
  let loadedSettings = {};
  let modelsLoading = false;
  let modelsLoadedAt = 0;
  let currentUsage = { input: 0, output: 0 };
  let attachedContext = { files: [], images: [] };
  let userIsNearBottom = true;
  // Webviews may restore DOM state; overlays must always start closed and only
  // open through their explicit trigger buttons.
  sessionMenu?.classList.add("hidden");
  contextInspector?.classList.add("hidden");
  contextPicker?.classList.add("hidden");

  const translations = {
    fa: {
      app_title: "هوشیار / Hooshyar",
      chat_empty_title: "هوشیار / Hooshyar",
      chat_empty_subtitle: "دستیار هوشمند شما برای برنامه‌نویسی، تحلیل، ویرایش و مدیریت پروژه",
      prompt_chip_1_label: "بررسی و تحلیل ساختار پروژه",
      prompt_chip_1_prompt: "ساختار و معماری کلی پروژه را بررسی و تحلیل کن",
      prompt_chip_2_label: "بررسی کد و رفع باگ‌ها",
      prompt_chip_2_prompt: "کد پروژه را بررسی کن و باگ‌ها و نقاط ضعف را برطرف کن",
      prompt_chip_3_label: "ایجاد فایل مستندات README",
      prompt_chip_3_prompt: "یک فایل README جامع به زبان فارسی و انگلیسی برای این پروژه بساز",
      prompt_chip_4_label: "توضیح و بهینه‌سازی فایل فعال",
      prompt_chip_4_prompt: "فایل فعال در ادیتور را توضیح بده و پیشنهادهای بهبود را بگو",
      input_placeholder: "از هوشیار بپرسید... (@file @workspace)",
      input_placeholder_chat: "گفتگو با هوشیار... (بدون تغییر فایل‌ها)",
      mode_agent: "اجنت",
      mode_agent_title: "حالت اجنت: برنامه‌ریزی، ویرایش و ایجاد خودکار فایل‌ها",
      mode_chat: "چت",
      mode_chat_title: "حالت چت: فقط گفتگو و راهنمایی کد بدون تغییر در فایل‌ها",
      send_btn: "ارسال",
      send_btn_title: "ارسال پیام (Enter)",
      stop_btn: "⏹ توقف",
      stop_btn_title: "توقف پاسخ دستیار",
      attach_btn_title: "ضمیمه فایل یا تصویر",
      attach_txt_md_title: "اساین فایل‌های متنی و مارک‌داون (.txt / .md)",
      attach_active_btn_title: "ضمیمه فایل باز ادیتور",
      sidebar_toggle_title: "تاریخچه گفتگوها",
      settings_btn_title: "تنظیمات",
      help_btn_title: "راهنمای تهیه API و پشتیبانی",
      lang_btn_title: "تغییر زبان به انگلیسی (Switch to English)",
      settings_title: "تنظیمات هوشیار",
      api_help_badge: "راهنمای تهیه کلید اختصاصی API",
      api_help_text: "برای دریافت کلید API هوشیار با سرعت بالا و دسترسی به انواع مدل‌ها، از طریق تلگرام با ما در ارتباط باشید:",
      tg_label: "تهیه از طریق تلگرام:",
      open_tg_btn: "ارسال پیام در تلگرام",
      copy_tg_btn: "کپی آیدی",
      copied_text: "✓ کپی شد!",
      api_section_title: "اتصال و سرویس‌دهنده API",
      api_format_label: "پروتکل API:",
      base_url_label: "آدرس سرور (Base URL):",
      base_url_hint: "مسیر /messages یا /chat/completions به طور خودکار طبق پروتکل اضافه می‌شود.",
      api_key_label: "کلید امنیتی (API Key):",
      api_key_hint: "به صورت امن در حافظه رمزنگاری‌شده VS Code ذخیره می‌شود.",
      model_label: "نام مدل هوش مصنوعی:",
      test_conn_btn: "🔌 تست اتصال",
      params_section_title: "پارامترها و ابزارها",
      temp_label: "دما (Temperature):",
      max_tokens_label: "حداکثر توکن خروجی:",
      tools_protocol_label: "نوع ابزارها:",
      enable_tools_label: "فعال بودن ابزارهای خواندن و نوشتن فایل در پروژه",
      enable_shell_label: "اجازه اجرای دستورات شل و تست در ترمینال (Terminal & Tests)",
      require_approval_label: "تایید کاربر قبل از هرگونه تغییر یا ذخیره فایل",
      auto_approve_commands_label: "⚡ تایید خودکار دستورات ترمینال (بدون نیاز به تایید دستی)",
      auto_approve_mode_label: "حالت تایید خودکار عملیات:",
      auto_include_label: "ضمیمه خودکار محتوای فایل باز ادیتور",
      skills_section_title: "مهارت‌ها",
      skills_hint: "تخصص‌های قابل استفاده مجدد، مانند توسعه لاراول. مهارت‌ها مستقل از ابزارهای MCP هستند و می‌توانند در کنار آن‌ها استفاده شوند.",
      add_skill_btn: "＋ افزودن مهارت",
      no_skills: "هنوز مهارتی اضافه نشده است",
      remove_skill: "حذف مهارت",
      mcp_section_title: "پروتکل زمینه مدل (MCP)",
      mcp_config_label: "پیکربندی سرورهای MCP (JSON):",
      mcp_hint: "پیکربندی سرورهای MCP با فرمت JSON. توکن‌های امنیتی Figma به‌صورت خودکار از مخزن امن به درخواست‌ها افزوده می‌شوند.",
      save_btn: "ذخیره تنظیمات",
      cancel_btn: "بستن",
      help_modal_title: "راهنما و تهیه API هوشیار",
      tg_badge_lead: "پشتیبانی و تهیه کلید اختصاصی",
      help_card_desc: "برای تهیه کلید API پرسرعت هوشیار، افزایش اعتبار، پشتیبانی فنی و دسترسی به مدل‌های روز هوش مصنوعی:",
      guide_steps_header: "مراحل فعال‌سازی و شروع به کار:",
      step1_title: "دریافت API Key از تلگرام",
      step1_desc: "در تلگرام به آیدی @lildevelop پیام دهید تا کلید API اختصاصی شما صادر گردد.",
      step2_title: "تنظیم در افزونه هوشیار",
      step2_desc: "روی آیکون چرخ‌دنده (⚙️) بالای افزونه کلیک کنید، کلید API خود را وارد کنید، دکمه تست اتصال را بزنید و سپس ذخیره کنید.",
      step3_title: "اساین فایل‌ها و برنامه‌نویسی هوشمند",
      step3_desc: "با دکمه 📝 فایل‌های متنی و مارک‌داون (.txt / .md) را مستقیماً اساین کنید، با @file یا @workspace کل پروژه را فراخوانی کرده و از تغییرات مرحله‌ای بهره ببرید.",
      features_header: "قابلیت‌های برجسته هوشیار:",
      feat_1: "✅ ویرایش هوشمند و دقیق فایل‌ها (ویرایش بخش هدف بدون بازنویسی کل فایل)",
      feat_2: "✅ اساین و پیوست مستقیم فایل‌های متنی (.txt) و مستندات (.md)",
      feat_3: "✅ پشتیبانی دوزبانه انگلیسی و فارسی همراه با تغییر جهت راست‌چین / چپ‌چین",
      feat_4: "✅ پیش‌نمایش تفاوت کدها (Diff Preview) و درخواست تایید قبل از هر تغییر",
      feat_5: "✅ مانیتورینگ دقیق و لحظه‌ای وضعیت کار دستیار هوشیار",
      close_btn: "بستن"
    },
    en: {
      app_title: "Hooshyar AI",
      chat_empty_title: "Hooshyar AI",
      chat_empty_subtitle: "Your intelligent assistant for coding, project analysis, smart editing, and workspace management",
      prompt_chip_1_label: "Analyze workspace architecture",
      prompt_chip_1_prompt: "Analyze the overall architecture and structure of this project",
      prompt_chip_2_label: "Inspect code & fix bugs",
      prompt_chip_2_prompt: "Inspect the project code, identify any bugs or weaknesses, and fix them",
      prompt_chip_3_label: "Generate README documentation",
      prompt_chip_3_prompt: "Generate a comprehensive README file with setup and usage instructions",
      prompt_chip_4_label: "Explain & optimize active file",
      prompt_chip_4_prompt: "Explain the active editor file and provide optimization suggestions",
      input_placeholder: "Ask Hooshyar... (@file @workspace)",
      input_placeholder_chat: "Chat with Hooshyar... (no file modifications)",
      mode_agent: "Agent",
      mode_agent_title: "Agent Mode: Autonomous execution, edits & creates files",
      mode_chat: "Chat",
      mode_chat_title: "Chat Mode: Conversation only, no file edits",
      send_btn: "Send",
      send_btn_title: "Send message (Enter)",
      stop_btn: "⏹ Stop",
      stop_btn_title: "Stop generation",
      attach_btn_title: "Attach file or image",
      attach_txt_md_title: "Assign text or markdown files (.txt / .md)",
      attach_active_btn_title: "Attach active editor file",
      sidebar_toggle_title: "Chat history",
      settings_btn_title: "Settings",
      help_btn_title: "API Guide & Support",
      lang_btn_title: "تغییر زبان به فارسی (Switch to Persian)",
      settings_title: "Hooshyar Settings",
      api_help_badge: "Get Dedicated API Key",
      api_help_text: "To obtain a high-speed Hooshyar API key and access frontier models, contact us on Telegram:",
      tg_label: "Get via Telegram:",
      open_tg_btn: "Message on Telegram",
      copy_tg_btn: "Copy ID",
      copied_text: "✓ Copied!",
      api_section_title: "API & Connection",
      api_format_label: "API Protocol:",
      base_url_label: "Base URL:",
      base_url_hint: "Endpoints (/messages or /chat/completions) are automatically resolved.",
      api_key_label: "API Key:",
      api_key_hint: "Securely stored in VS Code Secret Storage.",
      model_label: "AI Model Name:",
      test_conn_btn: "🔌 Test Connection",
      params_section_title: "Parameters & Tools",
      temp_label: "Temperature:",
      max_tokens_label: "Max Output Tokens:",
      tools_protocol_label: "Tool Protocol:",
      enable_tools_label: "Enable file read and write tools in workspace",
      enable_shell_label: "Allow running shell commands and tests in terminal",
      require_approval_label: "Require user approval before modifying files",
      auto_approve_commands_label: "⚡ Auto-Approve Terminal Commands",
      auto_approve_mode_label: "Auto-Approve Mode:",
      auto_include_label: "Auto-attach active editor file content",
      skills_section_title: "Skills",
      skills_hint: "Reusable expertise such as Laravel development. Skills are independent from MCP tools and can be used alongside them.",
      add_skill_btn: "＋ Add Skill",
      no_skills: "No skills added yet",
      remove_skill: "Remove skill",
      mcp_section_title: "Model Context Protocol (MCP)",
      mcp_config_label: "MCP server configuration (JSON):",
      mcp_hint: "Configure MCP servers as JSON. Figma security tokens are automatically injected from secure storage.",
      save_btn: "Save Settings",
      cancel_btn: "Close",
      help_modal_title: "Hooshyar API Guide & Support",
      tg_badge_lead: "Dedicated API Key & Support",
      help_card_desc: "To get your dedicated high-speed API key, recharge credits, or get technical support:",
      guide_steps_header: "Getting Started Guide:",
      step1_title: "Obtain API Key via Telegram",
      step1_desc: "Send a message to @lildevelop on Telegram to receive your dedicated API key.",
      step2_title: "Configure in Hooshyar",
      step2_desc: "Click the Settings (⚙️) icon, paste your key, test the connection, and save.",
      step3_title: "Assign Files & Start Coding",
      step3_desc: "Use 📝 to directly assign .txt / .md files, mention files with @file, and leverage safe incremental editing.",
      features_header: "Hooshyar Key Highlights:",
      feat_1: "✅ Precise partial file editing without accidental total overwrites",
      feat_2: "✅ Dedicated assignment for documentation and text files (.txt / .md)",
      feat_3: "✅ Full bilingual support (Persian & English) with instant RTL/LTR switching",
      feat_4: "✅ Visual Diff preview and approval modal before executing file writes",
      feat_5: "✅ Real-time agent activity & progress tracking",
      close_btn: "Close"
    }
  };

  let currentLang = localStorage.getItem("hooshyar_language") || "fa";

  function setModeUI(mode) {
    currentMode = mode === "chat" ? "ask" : (mode || "agent");
    if (modeAgentBtn && modeChatBtn && modePlanBtn) {
      modeAgentBtn.classList.toggle("active", currentMode === "agent");
      modeChatBtn.classList.toggle("active", currentMode === "ask");
      modePlanBtn.classList.toggle("active", currentMode === "plan");
    }
    updateInputPlaceholder();
  }

  function updateInputPlaceholder() {
    const t = translations[currentLang] || translations.fa;
    if (inputEl) {
      if (currentMode === "ask") {
        inputEl.placeholder = t.input_placeholder_chat || "گفتگو با هوشیار... (بدون تغییر فایل‌ها)";
      } else if (currentMode === "plan") {
        inputEl.placeholder = "Describe what you want to plan…";
      } else {
        inputEl.placeholder = t.input_placeholder || "از هوشیار بپرسید... (@file @workspace)";
      }
    }
  }

  function setLanguage(lang) {
    currentLang = lang;
    try {
      localStorage.setItem("hooshyar_language", lang);
    } catch (_) {}

    // Keep application chrome in the native VS Code LTR layout. Individual
    // messages and the composer determine RTL/LTR from their own content.
    document.documentElement.dir = "ltr";
    document.documentElement.lang = lang;

    document.querySelectorAll("[data-i18n]").forEach((el) => {
      const key = el.getAttribute("data-i18n");
      if (key && translations[lang] && translations[lang][key]) {
        el.textContent = translations[lang][key];
      }
    });

    document.querySelectorAll("[data-i18n-title]").forEach((el) => {
      const key = el.getAttribute("data-i18n-title");
      if (key && translations[lang] && translations[lang][key]) {
        el.title = translations[lang][key];
      }
    });

    document.querySelectorAll("[data-i18n-placeholder]").forEach((el) => {
      const key = el.getAttribute("data-i18n-placeholder");
      if (key && translations[lang] && translations[lang][key]) {
        el.placeholder = translations[lang][key];
      }
    });

    updateInputPlaceholder();

    if (langBtn) {
      langBtn.textContent = lang === "fa" ? "🌐 FA" : "🌐 EN";
      langBtn.title = lang === "fa" ? "تغییر زبان به انگلیسی / Switch to English" : "Switch language to Persian / تغییر زبان به فارسی";
    }

    applyTextDirection(inputEl.value);

    const emptyEl = messagesEl.querySelector(".chat-empty");
    if (emptyEl) {
      emptyEl.remove();
      renderChatEmpty();
    }
  }

  let currentSessionId = "";
  let mentionStart = -1;
  let isStreamingActive = false;

  function formatTokens(n) {
    if (n >= 1000) return (n / 1000).toFixed(n >= 10000 ? 0 : 1) + "k";
    return String(n);
  }

  let currentAssistantBubble = null;
  let currentAssistantRaw = "";
  let thinkingBubble = null;
  const statusIcon = { pending: "\u25CB", in_progress: "\u25D0", completed: "\u2713" };
  const KNOWN_TOOLS = [
    "read_file",
    "write_file",
    "list_files",
    "list_codebase",
    "search_codebase",
    "semantic_search",
    "find_symbol",
    "find_definition",
    "find_references",
    "find_implementations",
    "get_hover",
    "get_document_symbols",
    "get_call_hierarchy",
    "rename_symbol",
    "update_tasks",
    "search_replace",
    "run_command",
    "run_in_terminal",
    "task_complete"
  ];

  const MAX_RENDERED_MESSAGES = 150;
  function pruneOldMessagesIfNeeded() {
    if (!messagesEl) return;
    const children = Array.from(messagesEl.children).filter(
      (c) => !c.classList.contains("chat-empty") && c !== currentAssistantBubble
    );
    if (children.length <= MAX_RENDERED_MESSAGES) return;

    let expander = messagesEl.querySelector(".messages-collapsed-notice");
    if (!expander) {
      expander = document.createElement("div");
      expander.className = "messages-collapsed-notice";
      expander.style.textAlign = "center";
      expander.style.padding = "6px 12px";
      expander.style.margin = "8px auto";
      expander.style.fontSize = "11px";
      expander.style.color = "var(--vscode-descriptionForeground)";
      expander.style.background = "var(--vscode-badge-background)";
      expander.style.borderRadius = "12px";
      expander.style.cursor = "pointer";
      expander.style.width = "fit-content";
      expander.setAttribute("title", "Click to expand older messages");
      expander.addEventListener("click", () => {
        const hiddenEls = messagesEl.querySelectorAll(".msg-hidden-pruned");
        hiddenEls.forEach((el) => {
          el.style.display = "";
          el.classList.remove("msg-hidden-pruned");
        });
        expander.remove();
      });
      messagesEl.insertBefore(expander, messagesEl.firstChild);
    }

    const excess = children.length - MAX_RENDERED_MESSAGES;
    let prunedCount = 0;
    for (let i = 0; i < children.length && prunedCount < excess; i++) {
      const child = children[i];
      if (child === expander || child.classList.contains("msg-hidden-pruned")) continue;
      child.style.display = "none";
      child.classList.add("msg-hidden-pruned");
      prunedCount++;
    }

    const totalHidden = messagesEl.querySelectorAll(".msg-hidden-pruned").length;
    expander.textContent = `⚡ پیام‌های قدیمی‌تر جهت بهینه‌سازی جمع شدند (${totalHidden} پیام) — کلیک برای نمایش`;
  }

  function scrollToBottom(force = false) {
    pruneOldMessagesIfNeeded();
    if (force || userIsNearBottom) {
      messagesEl.scrollTop = messagesEl.scrollHeight;
      userIsNearBottom = true;
      newActivityBtn?.classList.add("hidden");
    } else {
      newActivityBtn?.classList.remove("hidden");
    }
  }

  messagesEl.addEventListener("scroll", () => {
    userIsNearBottom = messagesEl.scrollHeight - messagesEl.scrollTop - messagesEl.clientHeight < 72;
    if (userIsNearBottom) newActivityBtn?.classList.add("hidden");
  }, { passive: true });
  newActivityBtn?.addEventListener("click", () => scrollToBottom(true));

  function autoResizeInput() {
    inputEl.style.height = "38px";
    inputEl.style.overflowY = "hidden";
    const next = Math.min(Math.max(inputEl.scrollHeight, 38), 180);
    inputEl.style.height = next + "px";
    inputEl.style.overflowY = next >= 180 ? "auto" : "hidden";
  }

  function renderChatEmpty() {
    if (messagesEl.querySelector(".chat-empty")) return;
    if (messagesEl.children.length > 0) return;
    const t = translations[currentLang] || translations.fa;
    const el = document.createElement("div");
    el.className = "chat-empty";
    el.innerHTML =
      '<div class="chat-empty-mark" aria-hidden="true"><span>⌁</span></div>' +
      '<div class="chat-empty-title"><span>' + escapeHtml(t.chat_empty_title) + '</span></div>' +
      '<p class="chat-empty-subtitle">' + escapeHtml(t.chat_empty_subtitle) + '</p>' +
      '<div class="prompt-chips">' +
      '<button type="button" class="prompt-chip" data-prompt="' + escapeHtml(t.prompt_chip_1_prompt) + '"><span class="chip-icon">⌕</span><span>' + escapeHtml(t.prompt_chip_1_label) + '</span></button>' +
      '<button type="button" class="prompt-chip" data-prompt="' + escapeHtml(t.prompt_chip_2_prompt) + '"><span class="chip-icon">⌘</span><span>' + escapeHtml(t.prompt_chip_2_label) + '</span></button>' +
      '<button type="button" class="prompt-chip" data-prompt="' + escapeHtml(t.prompt_chip_3_prompt) + '"><span class="chip-icon">□</span><span>' + escapeHtml(t.prompt_chip_3_label) + '</span></button>' +
      '<button type="button" class="prompt-chip" data-prompt="' + escapeHtml(t.prompt_chip_4_prompt) + '"><span class="chip-icon">✦</span><span>' + escapeHtml(t.prompt_chip_4_label) + '</span></button>' +
      '</div>';
    messagesEl.appendChild(el);
  }

  function clearChatEmpty() {
    const el = messagesEl.querySelector(".chat-empty");
    if (el) el.remove();
  }

  // Removes tool-call markup so the user only sees natural language, even mid-stream
  // when a tag is only partially received.
  function sanitizeAssistantText(text) {
    if (!text) return "";
    let out = text.replace(/\[hooshyar_task_complete\]/g, "");
    // Strip thinking tags and any stray single '>' that immediately follows them
    out = out.replace(/<thinking_mode>[\s\S]*?<\/thinking_mode>\s*>?[ \t]*/gi, "");
    out = out.replace(/<think>[\s\S]*?<\/think>\s*>?[ \t]*/gi, "");
    
    out = out.replace(/<tool_call>[\s\S]*?<\/tool_call>/gi, "");
    out = out.replace(/<function>[\s\S]*?<\/function>/gi, "");
    out = out.replace(/:::writing\{[^}]*\}\s*/gi, "");
    for (const tool of KNOWN_TOOLS) {
      const re = new RegExp("<" + tool + ">[\\s\\S]*?<\\/" + tool + ">", "gi");
      out = out.replace(re, "");
    }
    // Cut off any still-open (partially streamed) tool-call tag and everything after it.
    const openMarkers = ["<tool_call", "<function", "<thinking_mode", "<think"];
    for (const tool of KNOWN_TOOLS) openMarkers.push("<" + tool);
    let cut = -1;
    for (const marker of openMarkers) {
      const idx = out.indexOf(marker);
      if (idx !== -1 && (cut === -1 || idx < cut)) cut = idx;
    }
    if (cut !== -1) out = out.slice(0, cut);
    // Trailing partial like "<read_" that could be the start of a tool tag.
    const lastLt = out.lastIndexOf("<");
    if (lastLt !== -1 && out.indexOf(">", lastLt) === -1) {
      const suffix = out.slice(lastLt);
      if (openMarkers.some((m) => m.startsWith(suffix))) {
        out = out.slice(0, lastLt);
      }
    }
    return out.trim();
  }

  function escapeHtml(s) {
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  function renderInline(text) {
    let out = text.replace(/`([^`]+)`/g, (_m, c) => "<code>" + c + "</code>");
    out = out.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
    out = out.replace(/(^|[^*])\*([^*]+)\*(?!\*)/g, "$1<em>$2</em>");
    out = out.replace(/(^|[\s(])([\w./\\-]+\.(?:ts|tsx|js|jsx|mjs|cjs|py|go|rs|java|cs|php|vue|svelte|html|css|scss|json|md|yml|yaml))(?:\:(\d+)(?:-(\d+))?)?/gi,
      (_m, prefix, path, line, end) => prefix + '<button type="button" class="file-ref" data-path="' + path + '" data-line="' + (line || "") + '" title="Open ' + path + (line ? ':' + line + (end ? '-' + end : '') : '') + '">' + path + (line ? ':' + line + (end ? '-' + end : '') : '') + '</button>');
    out = out.replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, '<a href="$2">$1</a>');
    return out;
  }

  // Minimal, safe Markdown -> HTML (code blocks, headings, lists, bold/italic/inline code).
  function renderMarkdown(src) {
    const escaped = escapeHtml(src);
    const lines = escaped.split("\n");
    let html = "";
    let i = 0;
    let inList = false;
    const closeList = () => {
      if (inList === "ul") {
        html += "</ul>";
        inList = false;
      } else if (inList === "ol") {
        html += "</ol>";
        inList = false;
      }
    };

    while (i < lines.length) {
      const line = lines[i];
      const fence = line.match(/^\s*```(\w*)\s*$/);
      if (fence) {
        closeList();
        i++;
        let code = "";
        while (i < lines.length && !/^\s*```\s*$/.test(lines[i])) {
          code += lines[i] + "\n";
          i++;
        }
        i++;
        const lang = (fence[1] || "code").toLowerCase();
        const isRunnable = /^(bash|sh|zsh|shell|powershell|cmd|terminal|ps1|bat)$/i.test(lang);
        const runBtnHtml = isRunnable
          ? '<button type="button" class="code-run-btn" title="اجرا در ترمینال / Run in terminal">▶ Run</button>'
          : '';
        html +=
          '<div class="code-block">' +
          '<div class="code-block-header">' +
          '<span class="code-lang">' + lang + '</span>' +
          '<div class="code-header-actions">' +
          runBtnHtml +
          '<button type="button" class="code-insert-btn" title="درج در محل مکان‌نما / Insert at cursor">⎘ Insert</button>' +
          '<button type="button" class="code-copy-btn" title="کپی کردن کد / Copy code">📋 Copy</button>' +
          '</div>' +
          '</div>' +
          '<pre><code>' + code.replace(/\n$/, "") + '</code></pre>' +
          '</div>';
        continue;
      }

      const h = line.match(/^(#{1,6})\s+(.*)$/);
      if (h) {
        closeList();
        html += '<div class="md-h md-h' + h[1].length + '">' + renderInline(h[2]) + "</div>";
        i++;
        continue;
      }

      if (/^\s*>\s?/.test(line)) {
        closeList();
        html += '<blockquote>' + renderInline(line.replace(/^\s*>\s?/, "")) + '</blockquote>';
        i++;
        continue;
      }

      if (line.includes("|") && i + 1 < lines.length && /^\s*\|?\s*:?-{3,}/.test(lines[i + 1])) {
        closeList();
        const parseCells = (value) => value.replace(/^\s*\||\|\s*$/g, "").split("|").map((cell) => cell.trim());
        const headers = parseCells(line);
        i += 2;
        html += '<div class="md-table-wrap"><table><thead><tr>' + headers.map((cell) => '<th>' + renderInline(cell) + '</th>').join("") + '</tr></thead><tbody>';
        while (i < lines.length && lines[i].includes("|") && lines[i].trim()) {
          html += '<tr>' + parseCells(lines[i]).map((cell) => '<td>' + renderInline(cell) + '</td>').join("") + '</tr>';
          i++;
        }
        html += '</tbody></table></div>';
        continue;
      }

      const li = line.match(/^\s*[-*]\s+(.*)$/);
      if (li) {
        if (inList !== "ul") {
          closeList();
          html += "<ul>";
          inList = "ul";
        }
        html += "<li>" + renderInline(li[1]) + "</li>";
        i++;
        continue;
      }

      const oli = line.match(/^\s*(\d+)\.\s+(.*)$/);
      if (oli) {
        if (inList !== "ol") {
          closeList();
          html += "<ol>";
          inList = "ol";
        }
        html += "<li>" + renderInline(oli[2]) + "</li>";
        i++;
        continue;
      }

      if (/^\s*$/.test(line)) {
        closeList();
        i++;
        continue;
      }

      closeList();
      html += '<div class="md-p">' + renderInline(line) + "</div>";
      i++;
    }
    closeList();
    return html;
  }

  function displayUserText(raw) {
    if (/^\s*\[SYSTEM:/i.test(raw || "")) return "";
    const requestMarker = "[hooshyar_user_request]";
    const taggedIndex = raw.lastIndexOf(requestMarker);
    if (taggedIndex >= 0) {
      return raw.slice(taggedIndex + requestMarker.length).trim();
    }
    if (/\[(?:environment_details|Initial Markdown context|Markdown file:|Active file:)/i.test(raw)) {
      const environmentEnd = raw.lastIndexOf("[/environment_details]");
      const fenceEnd = raw.lastIndexOf("```");
      const contextEnd = Math.max(
        environmentEnd >= 0 ? environmentEnd + "[/environment_details]".length : -1,
        fenceEnd >= 0 ? fenceEnd + 3 : -1
      );
      const trailingText = contextEnd >= 0 ? raw.slice(contextEnd).trim() : "";
      if (trailingText) return trailingText;
    }
    const legacyParts = raw.split(/\r?\n---\r?\n\r?\n/);
    return (legacyParts.length > 1 ? legacyParts[legacyParts.length - 1] : raw).trim();
  }

  function isPersianText(text) {
    return /[\u0600-\u06FF]/.test(text || "");
  }

  function applyTextDirection(text) {
    if (!text || !text.trim()) {
      inputEl.dir = currentLang === "fa" ? "rtl" : "ltr";
      return;
    }
    const rtl = isPersianText(text);
    inputEl.dir = rtl ? "rtl" : "ltr";
  }

  function setElementDirection(el, text) {
    if (!el) return;
    el.setAttribute("dir", isPersianText(text) ? "rtl" : "ltr");
  }

  function userTextFromContent(content) {
    if (typeof content === "string") return displayUserText(content);
    if (!Array.isArray(content)) return "";
    return displayUserText(
      content
        .filter((b) => b.type === "text")
        .map((b) => b.text)
        .join("\n")
    );
  }

  function rawTextFromContent(content) {
    if (typeof content === "string") return content;
    if (!Array.isArray(content)) return "";
    return content.filter((b) => b.type === "text").map((b) => b.text).join("\n");
  }

  function addUserBubble(text) {
    const displayText = displayUserText(text);
    if (!displayText || !displayText.trim()) return;
    finalizeActiveActivityCard();
    clearChatEmpty();

    const wrap = document.createElement("div");
    wrap.className = "msg-user-wrap";

    const header = document.createElement("div");
    header.className = "msg-header user-header";
    const authorName = currentLang === "fa" ? "شما" : "You";
    const editTitle = currentLang === "fa" ? "ویرایش و ارسال مجدد / Edit prompt" : "Edit prompt";
    const copyTitle = currentLang === "fa" ? "کپی متن / Copy" : "Copy";
    header.innerHTML =
      '<div class="msg-author">' +
        '<span class="author-icon">👤</span>' +
        '<span class="author-name">' + authorName + '</span>' +
      '</div>' +
      '<div class="msg-header-actions">' +
        '<button type="button" class="edit-msg-btn action-icon-btn" title="' + editTitle + '">✏️</button>' +
        '<button type="button" class="copy-msg-btn action-icon-btn" title="' + copyTitle + '">📋</button>' +
      '</div>';

    const div = document.createElement("div");
    div.className = "bubble user";
    div.textContent = displayText;
    div.setAttribute("data-raw-text", displayText);
    setElementDirection(div, displayText);

    wrap.appendChild(header);
    wrap.appendChild(div);
    messagesEl.appendChild(wrap);
    scrollToBottom();
  }

  function ensureAssistantBubble() {
    if (!currentAssistantBubble) {
      currentAssistantBubble = document.createElement("div");
      currentAssistantBubble.className = "bubble assistant";
      messagesEl.appendChild(currentAssistantBubble);
    }
    return currentAssistantBubble;
  }

  const toolCards = {};
  let activeActivityCard = null;

  const TOOL_META = {
    read_file: { icon: "📄", verb: "مطالعه فایل", enVerb: "Read file" },
    write_file: { icon: "✏️", verb: "ایجاد یا تغییر فایل", enVerb: "Write file" },
    list_files: { icon: "📁", verb: "فهرست فایل‌ها", enVerb: "List files" },
    list_codebase: { icon: "🗂️", verb: "کاوش ساختار پروژه", enVerb: "Explore codebase" },
    search_codebase: { icon: "🔍", verb: "جستجو در کدها", enVerb: "Search codebase" },
    semantic_search: { icon: "⌕", verb: "جستجوی معنایی", enVerb: "Semantic search" },
    delegate_to_subagents: { icon: "⌘", verb: "بررسی موازی ساب‌اجنت‌ها", enVerb: "Parallel sub-agent research" },
    find_symbol: { icon: "#", verb: "یافتن نماد", enVerb: "Find symbol" },
    find_definition: { icon: "→", verb: "یافتن تعریف", enVerb: "Find definition" },
    find_references: { icon: "↔", verb: "یافتن استفاده‌ها", enVerb: "Find references" },
    find_implementations: { icon: "◇", verb: "یافتن پیاده‌سازی‌ها", enVerb: "Find implementations" },
    get_hover: { icon: "i", verb: "اطلاعات نماد", enVerb: "Symbol info" },
    get_document_symbols: { icon: "#", verb: "ساختار فایل", enVerb: "Document symbols" },
    get_call_hierarchy: { icon: "⇄", verb: "زنجیره فراخوانی", enVerb: "Call hierarchy" },
    rename_symbol: { icon: "✎", verb: "تغییر نام نماد", enVerb: "Rename symbol" },
    search_replace: { icon: "✂️", verb: "ویرایش قطعه‌کد", enVerb: "Patch code" },
    update_tasks: { icon: "📋", verb: "به‌روزرسانی نقشه اقدام", enVerb: "Update plan" },
    run_command: { icon: "▶️", verb: "اجرای دستور ترمینال", enVerb: "Run command" },
    run_in_terminal: { icon: "💻", verb: "ارسال به ترمینال ادیتور", enVerb: "Run in VS Code terminal" },
    task_complete: { icon: "✓", verb: "تکمیل کار", enVerb: "Complete task" }
  };

  function getToolTargetChip(name, input) {
    input = input || {};
    switch (name) {
      case "read_file":
      case "write_file":
      case "search_replace":
        return input.path || "فایل";
      case "list_files":
        return input.path || ".";
      case "list_codebase":
        return input.path ? input.path : "ریشه پروژه / Root";
      case "search_codebase":
        return input.pattern ? `"${input.pattern}"` : "جستجو";
      case "run_command":
      case "run_in_terminal":
        return input.command || "دستور";
      case "update_tasks":
        return Array.isArray(input.tasks) ? `${input.tasks.length} تسک` : "برنامه";
      default:
        return Object.keys(input).length > 0 ? String(Object.values(input)[0]) : "";
    }
  }

  function friendlyToolTitlePersian(name, input) {
    const meta = TOOL_META[name];
    if (meta) return meta.verb;
    return name;
  }

  function summarizeResultPersian(name, content, isError) {
    if (isError) return "✕ خطا در اجرا";
    const trimmed = (content || "").trim();
    if (!trimmed) return "✓ تکمیل شد";
    if (trimmed === "(from history)" || trimmed === "(انجام شده در تاریخچه)") return "✓ انجام شده";
    if (/^\(no files found\)$/i.test(trimmed) || /^\(empty directory\)$/i.test(trimmed)) return "خالی (۰ فایل)";
    if (/^no matches found\.?$/i.test(trimmed)) return "موردی یافت نشد";
    const lines = trimmed.split("\n").length;
    if (name === "search_codebase") return `✓ ${lines} مورد`;
    if (name === "list_codebase" || name === "list_files") return `✓ ${lines} مورد`;
    if (name === "read_file") return `✓ ${lines} سطر`;
    if (name === "write_file") return "✓ ذخیره شد";
    if (name === "search_replace") return "✓ اصلاح شد";
    if (name === "run_command") return "✓ اجرا شد";
    return `✓ ${lines} سطر`;
  }

  function formatInput(input) {
    if (!input || Object.keys(input).length === 0) return "";
    return Object.keys(input)
      .map((k) => k + ": " + (typeof input[k] === "string" ? input[k] : JSON.stringify(input[k])))
      .join("\n");
  }

  class AgentActivityCard {
    constructor(isHistory = false) {
      this.isHistory = isHistory;
      this.steps = [];
      this.stepMap = {};
      this.hasError = false;
      this.isCompleted = false;

      this.cardEl = document.createElement("div");
      this.cardEl.className = "agent-activity-card " + (isHistory ? "completed collapsed" : "running");

      // Header
      this.headerEl = document.createElement("button");
      this.headerEl.type = "button";
      this.headerEl.className = "agent-activity-header";
      this.headerEl.title = currentLang === "fa" ? "کلیک برای مشاهده جزئیات عملیات" : "Click to toggle activity details";

      const headerMain = document.createElement("div");
      headerMain.className = "activity-header-main";

      this.statusIconEl = document.createElement("span");
      this.statusIconEl.className = "activity-status-icon";
      this.statusIconEl.textContent = isHistory ? "✓" : "⚡";

      this.titleEl = document.createElement("span");
      this.titleEl.className = "activity-title";
      this.titleEl.textContent = isHistory
        ? (currentLang === "fa" ? "عملیات انجام شده روی پروژه" : "Operations performed on workspace")
        : (currentLang === "fa" ? "در حال کاوش و کار روی پروژه..." : "Exploring workspace & running tools...");

      this.badgeEl = document.createElement("span");
      this.badgeEl.className = "activity-badge";
      this.badgeEl.textContent = currentLang === "fa" ? "۰ مرحله" : "0 steps";

      headerMain.appendChild(this.statusIconEl);
      headerMain.appendChild(this.titleEl);
      headerMain.appendChild(this.badgeEl);

      const headerMeta = document.createElement("div");
      headerMeta.className = "activity-header-meta";

      const chevron = document.createElement("span");
      chevron.className = "activity-chevron";
      chevron.textContent = "▾";

      headerMeta.appendChild(chevron);
      this.headerEl.appendChild(headerMain);
      this.headerEl.appendChild(headerMeta);
      this.headerEl.setAttribute("aria-expanded", String(!this.cardEl.classList.contains("collapsed")));

      // Body
      this.bodyEl = document.createElement("div");
      this.bodyEl.className = "agent-activity-body";

      this.stepListEl = document.createElement("div");
      this.stepListEl.className = "activity-step-list";
      this.bodyEl.appendChild(this.stepListEl);

      this.cardEl.appendChild(this.headerEl);
      this.cardEl.appendChild(this.bodyEl);

      // Header click toggles collapse
      this.headerEl.addEventListener("click", () => {
        this.setExpanded(this.cardEl.classList.contains("collapsed"), true);
      });

      messagesEl.appendChild(this.cardEl);
      scrollToBottom();
    }

    setExpanded(expanded, keepHeaderVisible = false) {
      this.cardEl.classList.toggle("collapsed", !expanded);
      this.headerEl.setAttribute("aria-expanded", String(expanded));
      if (expanded && keepHeaderVisible) {
        requestAnimationFrame(() => this.headerEl.scrollIntoView({ block: "start" }));
      }
    }

    addStep(id, name, input) {
      const meta = TOOL_META[name] || { icon: "🔧", verb: name };
      const target = getToolTargetChip(name, input);

      const stepEl = document.createElement("div");
      stepEl.className = "activity-step running collapsed";
      stepEl.id = "step-" + id;

      // Indicator (dot + line)
      const indicator = document.createElement("div");
      indicator.className = "step-indicator";
      const dot = document.createElement("span");
      dot.className = "step-dot";
      const line = document.createElement("span");
      line.className = "step-line";
      indicator.appendChild(dot);
      indicator.appendChild(line);

      // Main row
      const main = document.createElement("div");
      main.className = "step-main";

      const summaryRow = document.createElement("div");
      summaryRow.className = "step-summary-row";
      summaryRow.title = "کلیک برای مشاهده جزئیات ورودی/خروجی";
      summaryRow.setAttribute("role", "button");
      summaryRow.setAttribute("tabindex", "0");
      summaryRow.setAttribute("aria-expanded", "false");

      const icon = document.createElement("span");
      icon.className = "step-icon";
      icon.textContent = meta.icon;

      const verb = document.createElement("span");
      verb.className = "step-verb";
      verb.textContent = meta.verb;

      summaryRow.appendChild(icon);
      summaryRow.appendChild(verb);

      if (target) {
        const chip = document.createElement("span");
        chip.className = "step-target-chip";
        chip.textContent = target;
        chip.title = target;
        summaryRow.appendChild(chip);
      }

      // Add Diff and Revert buttons for file modification tools (search_replace, write_file)
      if ((name === "search_replace" || name === "write_file") && input && input.path) {
        const filePath = String(input.path).trim();
        const actionsDiv = document.createElement("div");
        actionsDiv.className = "step-actions";

        const diffBtn = document.createElement("button");
        diffBtn.type = "button";
        diffBtn.className = "step-action-btn step-diff-btn";
        diffBtn.title = currentLang === "fa" ? "مشاهده تغییرات در ادیتور VS Code (Diff)" : "View diff in VS Code editor";
        diffBtn.textContent = "🔍 Diff";
        diffBtn.onclick = (e) => {
          e.stopPropagation();
          vscode.postMessage({ type: "openDiff", path: filePath });
        };
        actionsDiv.appendChild(diffBtn);

        const revertBtn = document.createElement("button");
        revertBtn.type = "button";
        revertBtn.className = "step-action-btn step-revert-btn";
        revertBtn.title = currentLang === "fa" ? "بازگردانی فایل به نسخه قبل (Revert)" : "Revert file changes";
        revertBtn.textContent = "↩️";
        revertBtn.onclick = (e) => {
          e.stopPropagation();
          vscode.postMessage({ type: "revertFile", path: filePath });
        };
        actionsDiv.appendChild(revertBtn);

        summaryRow.appendChild(actionsDiv);
      }

      const spacer = document.createElement("span");
      spacer.className = "step-spacer";
      summaryRow.appendChild(spacer);

      const pill = document.createElement("span");
      pill.className = "step-status-pill " + (this.isHistory ? "ok" : "running");
      pill.textContent = this.isHistory ? "✓ انجام شد" : "⏳ در حال انجام...";
      summaryRow.appendChild(pill);

      const toggleBtn = document.createElement("span");
      toggleBtn.className = "step-toggle-btn";
      toggleBtn.textContent = "›";
      summaryRow.appendChild(toggleBtn);

      // Details container (initially collapsed)
      const details = document.createElement("div");
      details.className = "step-details";

      const errorSummary = document.createElement("div");
      errorSummary.className = "step-error-summary hidden";
      main.appendChild(summaryRow);
      main.appendChild(errorSummary);

      if ((name === "search_replace" || name === "write_file") && input && input.path) {
        const filePath = String(input.path).trim();
        const toolbar = document.createElement("div");
        toolbar.className = "step-details-toolbar";

        const bigDiffBtn = document.createElement("button");
        bigDiffBtn.type = "button";
        bigDiffBtn.className = "step-toolbar-btn step-toolbar-diff";
        bigDiffBtn.textContent = currentLang === "fa" ? "🔍 مشاهده تغییرات در ادیتور (Diff Editor)" : "🔍 Open in Diff Editor";
        bigDiffBtn.onclick = (e) => {
          e.stopPropagation();
          vscode.postMessage({ type: "openDiff", path: filePath });
        };

        const bigRevertBtn = document.createElement("button");
        bigRevertBtn.type = "button";
        bigRevertBtn.className = "step-toolbar-btn step-toolbar-revert";
        bigRevertBtn.textContent = currentLang === "fa" ? "↩️ بازگردانی این فایل (Revert File)" : "↩️ Revert File Changes";
        bigRevertBtn.onclick = (e) => {
          e.stopPropagation();
          vscode.postMessage({ type: "revertFile", path: filePath });
        };

        toolbar.appendChild(bigDiffBtn);
        toolbar.appendChild(bigRevertBtn);
        details.appendChild(toolbar);
      }

      const inputText = formatInput(input);
      if (inputText) {
        const inBlock = document.createElement("div");
        const inLabel = document.createElement("div");
        inLabel.className = "step-detail-label";
        inLabel.textContent = "ورودی / Input:";
        const inPre = document.createElement("pre");
        inPre.className = "step-detail-pre";
        inPre.textContent = inputText;
        inBlock.appendChild(inLabel);
        inBlock.appendChild(inPre);
        details.appendChild(inBlock);
      }

      const outBlock = document.createElement("div");
      const outLabel = document.createElement("div");
      outLabel.className = "step-detail-label";
      outLabel.textContent = "خروجی / Output:";
      const outPre = document.createElement("pre");
      outPre.className = "step-detail-pre";
      outPre.textContent = this.isHistory ? "(انجام شده)" : "(در انتظار دریافت خروجی...)";
      outBlock.appendChild(outLabel);
      outBlock.appendChild(outPre);
      details.appendChild(outBlock);

      main.appendChild(details);

      stepEl.appendChild(indicator);
      stepEl.appendChild(main);

      const toggleStep = () => {
        const expanded = stepEl.classList.contains("collapsed");
        stepEl.classList.toggle("collapsed", !expanded);
        summaryRow.setAttribute("aria-expanded", String(expanded));
      };
      summaryRow.addEventListener("click", toggleStep);
      summaryRow.addEventListener("keydown", (event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        toggleStep();
      });

      this.stepListEl.appendChild(stepEl);

      const stepObj = {
        id,
        name,
        input,
        stepEl,
        pill,
        outPre,
        errorSummary,
        isCompleted: this.isHistory
      };
      this.steps.push(stepObj);
      this.stepMap[id] = stepObj;

      this.updateHeaderProgress(name, target);
      scrollToBottom();
      return stepObj;
    }

    setStepResult(id, content, isError) {
      let step = this.stepMap[id];
      if (!step) {
        step = this.addStep(id, "result", {});
      }
      step.isCompleted = true;
      step.stepEl.classList.remove("running");
      step.stepEl.classList.add(isError ? "error" : "ok");

      step.pill.classList.remove("running");
      step.pill.classList.add(isError ? "error" : "ok");
      const fullResult = (content || "").trim();
      if (isError) {
        const firstLine = fullResult.split("\n").find((line) => line.trim()) || (currentLang === "fa" ? "علت نامشخص" : "Unknown cause");
        step.pill.textContent = currentLang === "fa" ? "✕ خطا" : "✕ Failed";
        step.pill.title = fullResult;
        step.errorSummary.textContent = firstLine;
        step.errorSummary.title = fullResult;
        step.errorSummary.classList.remove("hidden");
      } else {
        step.pill.textContent = summarizeResultPersian(step.name, content, false);
        step.pill.removeAttribute("title");
        step.errorSummary.textContent = "";
        step.errorSummary.classList.add("hidden");
      }

      step.outPre.textContent = fullResult || "(بدون خروجی / no output)";
      if (isError) {
        step.outPre.classList.add("error");
        this.hasError = true;
        this.cardEl.classList.add("has-error");
        step.stepEl.classList.remove("collapsed");
        this.setExpanded(true);
      }

      this.updateHeaderProgress();
      scrollToBottom();
    }

    updateHeaderProgress(lastToolName, lastTarget) {
      const total = this.steps.length;
      const done = this.steps.filter((s) => s.isCompleted).length;

      this.badgeEl.textContent = String(total);

      if (!this.isCompleted) {
        if (lastToolName) {
          const meta = TOOL_META[lastToolName] || { verb: lastToolName };
          this.titleEl.textContent = `در حال ${meta.verb}${lastTarget ? ` (${lastTarget})` : ""}... [${total}]`;
        } else {
          this.titleEl.textContent = `در حال انجام عملیات پروژه... (${done}/${total})`;
        }
      }
    }

    finalize() {
      if (this.isCompleted) return;
      this.isCompleted = true;
      this.cardEl.classList.remove("running");
      this.cardEl.classList.add("completed");

      const total = this.steps.length;
      if (total === 0) {
        this.cardEl.remove();
        return;
      }

      const isFa = currentLang === "fa";
      const edits = this.steps.filter((step) => ["write_file", "search_replace", "rename_symbol"].includes(step.name));
      const commands = this.steps.filter((step) => step.name === "run_command" || step.name === "run_in_terminal");
      const files = new Map();
      edits.forEach((step) => {
        const file = String(step.input?.path || "").trim();
        if (!file) return;
        const stats = files.get(file) || { added: 0, removed: 0 };
        stats.added += String(step.input?.new_string ?? step.input?.content ?? "").split("\n").length;
        stats.removed += step.name === "search_replace" ? String(step.input?.old_string || "").split("\n").length : 0;
        files.set(file, stats);
      });

      if (files.size || commands.length) {
        const summary = document.createElement("div");
        summary.className = "activity-change-summary";
        const toolbar = document.createElement("div");
        toolbar.className = "activity-change-toolbar";
        toolbar.innerHTML = `<strong>${files.size ? `${files.size} edited file${files.size === 1 ? "" : "s"}` : `${commands.length} command${commands.length === 1 ? "" : "s"}`}</strong><span></span>${files.size ? '<button type="button" data-undo>Undo ↶</button><button type="button" data-review>Review</button>' : ""}`;
        summary.appendChild(toolbar);
        files.forEach((stats, file) => {
          const row = document.createElement("button");
          row.type = "button";
          row.className = "activity-change-row";
          row.innerHTML = '<span></span><b class="added">+' + stats.added + '</b><b class="removed">-' + stats.removed + '</b>';
          row.querySelector("span").textContent = file;
          row.onclick = () => vscode.postMessage({ type: "openDiff", path: file });
          summary.appendChild(row);
        });
        commands.forEach((step) => {
          const row = document.createElement("div");
          const failed = step.stepEl.classList.contains("error");
          row.className = "activity-command-row";
          row.innerHTML = '<span>›</span><code></code><b class="' + (failed ? "failed" : "passed") + '">' + (failed ? "Failed" : "Passed") + '</b>';
          row.querySelector("code").textContent = String(step.input?.command || "command");
          summary.appendChild(row);
        });
        toolbar.querySelector("[data-review]")?.addEventListener("click", () => vscode.postMessage({ type: "openReviewChanges" }));
        toolbar.querySelector("[data-undo]")?.addEventListener("click", () => {
          vscode.postMessage({ type: "reviewDiscardAll" });
        });
        this.bodyEl.insertBefore(summary, this.stepListEl);
      }

      const labels = [];
      if (files.size) labels.push(isFa ? `${files.size} فایل ویرایش شد` : `${files.size} edited file${files.size === 1 ? "" : "s"}`);
      if (commands.length) labels.push(isFa ? `${commands.length} دستور اجرا شد` : `${commands.length} command${commands.length === 1 ? "" : "s"} run`);
      if (this.hasError) labels.push(isFa ? "دارای خطا" : "with errors");
      this.statusIconEl.textContent = this.hasError ? "⚠" : "✓";
      this.titleEl.textContent = labels.join(" · ") || (isFa ? "جزئیات عملیات" : "Operation details");
      this.badgeEl.textContent = String(total);
      // Completed runs stay as one compact row. The user can expand details explicitly.
      this.cardEl.classList.add("compact-complete");
      this.setExpanded(this.hasError);
    }
  }

  function ensureActivityCard(isHistory = false) {
    if (!activeActivityCard || activeActivityCard.isCompleted) {
      activeActivityCard = new AgentActivityCard(isHistory);
    }
    return activeActivityCard;
  }

  function finalizeActiveActivityCard() {
    if (activeActivityCard) {
      activeActivityCard.finalize();
      activeActivityCard = null;
    }
  }

  function addToolCard(id, name, input) {
    if (toolCards[id]) {
       // if we get an update with input, update the UI
       if (input && Object.keys(input).length > 0) {
           const target = getToolTargetChip(name, input);
           const inputText = formatInput(input);
           const step = toolCards[id].step;
           if (target && step.stepEl) {
               let chip = step.stepEl.querySelector(".step-target-chip");
               if (!chip) {
                   chip = document.createElement("span");
                   chip.className = "step-target-chip";
                   const summaryRow = step.stepEl.querySelector(".step-summary-row");
                   if (summaryRow) {
                       const spacer = summaryRow.querySelector(".step-spacer");
                       summaryRow.insertBefore(chip, spacer);
                   }
               }
               chip.textContent = target;
               chip.title = target;
           }
           if (inputText && step.stepEl) {
               let inBlock = step.stepEl.querySelector(".step-details > div");
               if (inBlock && inBlock.querySelector(".step-detail-label").textContent.includes("Input")) {
                   inBlock.querySelector(".step-detail-pre").textContent = inputText;
               } else {
                   const details = step.stepEl.querySelector(".step-details");
                   const newInBlock = document.createElement("div");
                   const inLabel = document.createElement("div");
                   inLabel.className = "step-detail-label";
                   inLabel.textContent = "ورودی / Input:";
                   const inPre = document.createElement("pre");
                   inPre.className = "step-detail-pre";
                   inPre.textContent = inputText;
                   newInBlock.appendChild(inLabel);
                   newInBlock.appendChild(inPre);
                   if (details.firstChild) details.insertBefore(newInBlock, details.firstChild);
                   else details.appendChild(newInBlock);
               }
           }
       }
       return;
    }
    clearChatEmpty();
    const card = ensureActivityCard(false);
    const step = card.addStep(id, name, input);
    toolCards[id] = { card, step, name };
  }

  function addToolResult(id, content, isError) {
    const entry = toolCards[id];
    if (entry && entry.card) {
      entry.card.setStepResult(id, content, isError);
    } else if (activeActivityCard) {
      activeActivityCard.setStepResult(id, content, isError);
    }
  }

  function renderHistoryMessages(messages) {
    if (isStreamingActive) {
      // Do not wipe DOM while a response is actively streaming
      return;
    }
    finalizeActiveActivityCard();
    messagesEl.innerHTML = "";
    for (const k of Object.keys(toolCards)) delete toolCards[k];
    currentAssistantBubble = null;
    currentAssistantRaw = "";

    // Pre-index tool results from user messages so history displays real results
    const toolResultsById = {};
    for (const m of messages || []) {
      if (m.role === "user" && Array.isArray(m.content)) {
        for (const b of m.content) {
          if (b.type === "tool_result" && b.tool_use_id) {
            toolResultsById[b.tool_use_id] = {
              content: typeof b.content === "string" ? b.content : JSON.stringify(b.content),
              isError: Boolean(b.is_error)
            };
          }
        }
      }
    }

    let pendingHistoryCard = null;

    for (const m of messages || []) {
      if (m.role === "user") {
        const rawText = rawTextFromContent(m.content);
        const text = userTextFromContent(m.content);
        if (rawText.includes("[Auto-compacted context")) {
          if (pendingHistoryCard) {
            pendingHistoryCard.finalize();
            pendingHistoryCard = null;
          }
          renderContextCompactCard(rawText.slice(rawText.indexOf("[Auto-compacted context")));
          continue;
        }
        const images =
          Array.isArray(m.content) ? m.content.filter((b) => b.type === "image") : [];
        const isToolResults =
          Array.isArray(m.content) &&
          m.content.length > 0 &&
          m.content.every((b) => b.type === "tool_result");
        if (isToolResults) continue;

        // When a real user message appears, finalize any pending history activity card
        if (pendingHistoryCard) {
          pendingHistoryCard.finalize();
          pendingHistoryCard = null;
        }

        if (text) {
          addUserBubble(text);
        } else if (images.length > 0) {
          clearChatEmpty();
          const div = document.createElement("div");
          div.className = "bubble user";
          div.textContent = "(image attached)";
          messagesEl.appendChild(div);
        }
        continue;
      }

      if (m.role === "assistant") {
        let text = "";
        if (typeof m.content === "string") {
          text = sanitizeAssistantText(m.content);
        } else if (Array.isArray(m.content)) {
          text = sanitizeAssistantText(
            m.content
              .filter((b) => b.type === "text")
              .map((b) => b.text)
              .join("")
          );
        }

        // Extract tool use blocks from array or string fallback
        let toolUseBlocks = [];
        if (Array.isArray(m.content)) {
          toolUseBlocks = m.content.filter((b) => b.type === "tool_use");
        } else if (typeof m.content === "string" && (m.content.includes("<tool_call") || m.content.includes("<function"))) {
          const tcRegex = /<tool_call>([\s\S]*?)<\/tool_call>/g;
          let match;
          while ((match = tcRegex.exec(m.content)) !== null) {
            try {
              const parsed = JSON.parse(match[1].trim());
              if (parsed && parsed.name) {
                toolUseBlocks.push({ id: "hist_" + Math.random().toString(36).slice(2, 7), name: parsed.name, input: parsed.input || {} });
              }
            } catch (_) {}
          }
        }

        // Accumulate consecutive tool calls into ONE single activity card
        if (toolUseBlocks.length > 0) {
          clearChatEmpty();
          if (!pendingHistoryCard) {
            pendingHistoryCard = new AgentActivityCard(true);
          }
          for (const b of toolUseBlocks) {
            pendingHistoryCard.addStep(b.id, b.name, b.input || {});
            const res = toolResultsById[b.id] || { content: "(انجام شده در تاریخچه)", isError: false };
            pendingHistoryCard.setStepResult(b.id, res.content, res.isError);
          }
        }

        if (text) {
          if (pendingHistoryCard) {
            pendingHistoryCard.finalize();
            pendingHistoryCard = null;
          }
          clearChatEmpty();
          const wrap = document.createElement("div");
          wrap.className = "assistant-wrap";
          setElementDirection(wrap, text);
          const div = document.createElement("div");
          div.className = "bubble assistant";
          setElementDirection(div, text);
          div.innerHTML = renderMarkdown(text);
          wrap.appendChild(div);
          addMessageActions(wrap, text);
          messagesEl.appendChild(wrap);
        }
        continue;
      }
    }

    if (pendingHistoryCard) {
      pendingHistoryCard.finalize();
      pendingHistoryCard = null;
    }

    if (messagesEl.children.length === 0) renderChatEmpty();
    scrollToBottom();
  }

  function renderContextCompactCard(text, stats) {
    clearChatEmpty();
    const details = document.createElement("details");
    details.className = "context-compact-card";
    const summary = document.createElement("summary");
    summary.textContent = stats
      ? `Context compressed automatically · ${formatTokens(stats.beforeTokens)} → ${formatTokens(stats.afterTokens)} tokens`
      : (currentLang === "fa" ? "کانتکست قدیمی به‌صورت خودکار فشرده شد" : "Older context compressed automatically");
    details.appendChild(summary);
    if (text) {
      const body = document.createElement("div");
      body.className = "context-compact-body";
      body.innerHTML = renderMarkdown(
        text
          .replace(/^\[Auto-compacted context[^\]]*\]\s*/i, "")
          .replace(/\s*\[Continue from the recent verbatim turns below\.\]\s*$/i, "")
      );
      details.appendChild(body);
    }
    messagesEl.appendChild(details);
    scrollToBottom();
  }

  function addMessageActions(wrap, text) {
    const actions = document.createElement("div");
    actions.className = "msg-actions";
    const copyBtn = document.createElement("button");
    copyBtn.type = "button";
    copyBtn.innerHTML = "📋 Copy";
    copyBtn.title = "کپی کردن متن پاسخ / Copy answer";
    copyBtn.onclick = () => {
      navigator.clipboard.writeText(text).then(() => {
        copyBtn.innerHTML = "✓ Copied!";
        copyBtn.classList.add("copied");
        setTimeout(() => {
          copyBtn.innerHTML = "📋 Copy";
          copyBtn.classList.remove("copied");
        }, 1500);
      });
    };
    const insertBtn = document.createElement("button");
    insertBtn.type = "button";
    insertBtn.innerHTML = "📝 Insert";
    insertBtn.title = "درج در محل مکان‌نمای ادیتور / Insert at editor cursor";
    insertBtn.onclick = () => {
      vscode.postMessage({ type: "insertAtCursor", text });
      insertBtn.innerHTML = "✓ Inserted!";
      insertBtn.classList.add("copied");
      setTimeout(() => {
        insertBtn.innerHTML = "📝 Insert";
        insertBtn.classList.remove("copied");
      }, 1500);
    };
    const retryBtn = document.createElement("button");
    retryBtn.type = "button";
    retryBtn.innerHTML = "🔄 Retry";
    retryBtn.title = "تلاش مجدد آخرین پیام / Retry last turn";
    retryBtn.onclick = () => vscode.postMessage({ type: "retryLastTurn" });
    actions.appendChild(copyBtn);
    actions.appendChild(insertBtn);
    actions.appendChild(retryBtn);
    wrap.appendChild(actions);
  }

  function finalizeAssistantBubble(text) {
    const cleaned = sanitizeAssistantText(text);
    if (!cleaned) {
      if (currentAssistantBubble && currentAssistantBubble.parentNode) {
        currentAssistantBubble.remove();
      }
      currentAssistantBubble = null;
      return;
    }
    const wrap = document.createElement("div");
    wrap.className = "assistant-wrap";
    setElementDirection(wrap, cleaned);

    const header = document.createElement("div");
    header.className = "msg-header assistant-header";
    header.innerHTML =
      '<div class="msg-author">' +
        '<span class="author-icon sparkle">✨</span>' +
        '<span class="author-name">Hooshyar</span>' +
        '<span class="author-mode-badge">' + (currentMode === "agent" ? "Agent" : "Chat") + '</span>' +
      '</div>';
    wrap.appendChild(header);

    const bubble = currentAssistantBubble || document.createElement("div");
    bubble.className = "bubble assistant";
    setElementDirection(bubble, cleaned);
    bubble.innerHTML = renderMarkdown(cleaned);

    if (currentAssistantBubble && currentAssistantBubble.parentNode === messagesEl) {
      messagesEl.insertBefore(wrap, currentAssistantBubble);
      currentAssistantBubble.remove();
    } else {
      messagesEl.appendChild(wrap);
    }
    wrap.appendChild(bubble);
    addMessageActions(wrap, cleaned);
    currentAssistantBubble = null;
    scrollToBottom();
  }

  function renderSessionList(sessions, currentId) {
    currentSessionId = currentId || "";
    sessionListEl.innerHTML = "";

    if (!sessions || sessions.length === 0) {
      const empty = document.createElement("div");
      empty.className = "session-empty";
      empty.textContent = "No saved chats yet";
      sessionListEl.appendChild(empty);
      return;
    }

    const currentSession = (sessions || []).find((s) => s.id === currentId);
    const cleanTitle = (value) => {
      const title = String(value || "").replace(/<[^>]*>/g, " ").replace(/&(?:nbsp|#x20);/gi, " ").replace(/\s+/g, " ").trim();
      return !title || /^\[SYSTEM:/i.test(title) ? "New session" : title;
    };
    if (sessionSubtitle) sessionSubtitle.textContent = currentSession ? cleanTitle(currentSession.title) : "New session";
    let lastGroup = "";
    for (const s of sessions) {
      const ageDays = Math.floor((Date.now() - Number(s.updatedAt || 0)) / 86400000);
      const group = ageDays <= 0 ? "Today" : ageDays === 1 ? "Yesterday" : "Earlier";
      if (group !== lastGroup) {
        const heading = document.createElement("div");
        heading.className = "session-group-heading";
        heading.textContent = group;
        sessionListEl.appendChild(heading);
        lastGroup = group;
      }
      const row = document.createElement("div");
      row.className = "session-row" + (s.id === currentId ? " active" : "");
      row.setAttribute("tabindex", "0");
      row.setAttribute("role", "button");
      row.onkeydown = (event) => { if (event.key === "Enter" || event.key === " ") vscode.postMessage({ type: "loadSession", id: s.id }); };
      const state = document.createElement("span");
      state.className = "session-row-state";
      state.textContent = s.id === currentId && isStreamingActive ? "●" : "○";
      const title = document.createElement("span");
      title.className = "session-title";
      title.textContent = cleanTitle(s.title);
      title.title = cleanTitle(s.title);
      title.onclick = () => vscode.postMessage({ type: "loadSession", id: s.id });
      const actions = document.createElement("span");
      actions.className = "session-actions";
      const renameBtn = document.createElement("button");
      renameBtn.type = "button";
      renameBtn.textContent = "\u270E";
      renameBtn.title = "Rename";
      renameBtn.onclick = (e) => {
        e.stopPropagation();
        vscode.postMessage({ type: "promptRenameSession", id: s.id });
      };
      const delBtn = document.createElement("button");
      delBtn.type = "button";
      delBtn.textContent = "\u2715";
      delBtn.title = "Delete";
      delBtn.onclick = (e) => {
        e.stopPropagation();
        vscode.postMessage({ type: "deleteSession", id: s.id });
      };
      actions.appendChild(renameBtn);
      actions.appendChild(delBtn);
      row.appendChild(state);
      row.appendChild(title);
      row.appendChild(actions);
      sessionListEl.appendChild(row);
    }
  }

  let activeAutocompleteIndex = 0;
  let currentAutocompleteItems = [];
  let autocompletePrefix = "";

  const HASH_CONTEXT_ITEMS = [
    { label: "#file:", desc: "انتخاب فایل از پروژه / Pick workspace file", insert: "#file:" },
    { label: "#selection", desc: "کد انتخاب‌شده در ادیتور فعال / Active selection", insert: "#selection " },
    { label: "#editor", desc: "کل سند فعال در ادیتور / Active editor entire file", insert: "#editor " },
    { label: "#git", desc: "تغییرات جاری گیت (Git Diff) / Current git diff", insert: "#git " },
    { label: "#problems", desc: "خطاها و هشدارهای پروژه / Workspace diagnostics", insert: "#problems " },
    { label: "#tests", desc: "فایل‌های تست پروژه / Test files", insert: "#tests " },
    { label: "#codebase", desc: "نمای کلی فایل‌های پروژه / Codebase map", insert: "#codebase " },
    { label: "#terminal", desc: "خروجی یا بافر ترمینال / Terminal buffer", insert: "#terminal " }
  ];

  const SLASH_COMMAND_ITEMS = [
    { label: "/explain", desc: "توضیح کامل ساختار و منطق کد / Explain code", insert: "/explain " },
    { label: "/fix", desc: "یافتن و رفع باگ‌های کد / Find and fix bugs", insert: "/fix " },
    { label: "/tests", desc: "تولید تست‌های واحد خودکار / Generate unit tests", insert: "/tests " },
    { label: "/run", desc: "اجرای دستور یا تست در ترمینال / Run command or test in terminal", insert: "/run " },
    { label: "/doc", desc: "تولید مستندات و کامنت استاندارد / Generate docs", insert: "/doc " },
    { label: "/commit", desc: "تولید هوشمند پیام کامیت گیت / Generate commit message", insert: "/commit " },
    { label: "/clear", desc: "پاکسازی چت و شروع مجدد / Clear chat session", insert: "/clear" }
  ];

  function hideMentionMenu() {
    mentionMenu.classList.add("hidden");
    mentionMenu.innerHTML = "";
    mentionStart = -1;
    autocompletePrefix = "";
    currentAutocompleteItems = [];
    activeAutocompleteIndex = 0;
  }

  function showAutocompleteMenu(items) {
    mentionMenu.innerHTML = "";
    currentAutocompleteItems = items || [];
    activeAutocompleteIndex = 0;

    if (!items || items.length === 0) {
      hideMentionMenu();
      return;
    }
    mentionMenu.classList.remove("hidden");

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "mention-item" + (i === 0 ? " active" : "");

      const titleSpan = document.createElement("span");
      titleSpan.className = "item-title";
      titleSpan.textContent = item.label;

      const descSpan = document.createElement("span");
      descSpan.className = "item-desc";
      descSpan.textContent = item.desc || "";

      btn.appendChild(titleSpan);
      btn.appendChild(descSpan);

      btn.onclick = () => {
        applyAutocompleteItem(item);
      };
      mentionMenu.appendChild(btn);
    }
  }

  function updateActiveAutocompleteItem() {
    const buttons = mentionMenu.querySelectorAll(".mention-item");
    buttons.forEach((b, idx) => {
      if (idx === activeAutocompleteIndex) {
        b.classList.add("active");
        b.scrollIntoView({ block: "nearest" });
      } else {
        b.classList.remove("active");
      }
    });
  }

  function applyAutocompleteItem(item) {
    const val = inputEl.value;
    const cursor = inputEl.selectionStart;

    if (autocompletePrefix === "/") {
      inputEl.value = item.insert;
    } else if (autocompletePrefix === "#" || autocompletePrefix === "#file:") {
      const hashIndex = val.lastIndexOf("#", cursor);
      const before = hashIndex >= 0 ? val.slice(0, hashIndex) : "";
      const after = val.slice(cursor);
      inputEl.value = before + item.insert + after;
    } else {
      const before = val.slice(0, mentionStart);
      const after = val.slice(cursor);
      inputEl.value = before + "@" + (item.path || item.label) + " " + after;
    }

    hideMentionMenu();
    inputEl.focus();
    autoResizeInput();
  }

  function showMentionMenu(items) {
    autocompletePrefix = "@";
    const mapped = (items || []).map((item) => ({
      label: "@" + (item.label || item.path),
      path: item.path,
      desc: item.path,
      insert: "@" + item.path + " "
    }));
    showAutocompleteMenu(mapped);
  }

  function renderFollowUpPills(pills) {
    if (!pills || pills.length === 0) return;
    const lastAssistant = currentAssistantBubble || messagesEl.querySelector(".bubble.assistant:last-of-type");
    if (!lastAssistant) return;

    const existing = lastAssistant.querySelector(".followup-pills-container");
    if (existing) existing.remove();

    const container = document.createElement("div");
    container.className = "followup-pills-container";

    for (const pill of pills) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "followup-pill";
      btn.innerHTML = `<span class="pill-sparkle">✨</span><span>${pill}</span>`;
      btn.onclick = () => {
        inputEl.value = pill;
        formEl.requestSubmit();
      };
      container.appendChild(btn);
    }

    lastAssistant.appendChild(container);
    scrollToBottom();
  }

  function renderSessionReviewCard(files) {
    const existingCard = document.getElementById("session-review-card");
    if (!files || files.length === 0) {
      if (existingCard) existingCard.remove();
      return;
    }

    let card = existingCard;
    if (!card) {
      card = document.createElement("div");
      card.id = "session-review-card";
      card.className = "session-review-card";
      messagesEl.appendChild(card);
    }

    card.innerHTML = `
      <div class="review-header">
        <span>📝 ${files.length} فایل در این نشست تغییر یافته است / ${files.length} modified file(s)</span>
      </div>
      <div class="review-files-list">
        ${files.map(f => `<div class="review-file-item" data-path="${f}"><span>📄 ${f}</span> <span style="font-size:10px; opacity:0.7;">نمایش تغییرات</span></div>`).join("")}
      </div>
      <div class="review-actions">
        <button type="button" class="review-btn review-btn-discard" id="btn-review-discard">بازگردانی همه (Discard All)</button>
        <button type="button" class="review-btn review-btn-accept" id="btn-review-accept">تأیید همه (Accept All)</button>
      </div>
    `;

    card.querySelectorAll(".review-file-item").forEach((item) => {
      item.onclick = () => {
        const p = item.getAttribute("data-path");
        if (p) vscode.postMessage({ type: "openDiff", path: p });
      };
    });

    const acceptBtn = card.querySelector("#btn-review-accept");
    if (acceptBtn) {
      acceptBtn.onclick = () => {
        vscode.postMessage({ type: "reviewAcceptAll" });
      };
    }

    const discardBtn = card.querySelector("#btn-review-discard");
    if (discardBtn) {
      discardBtn.onclick = () => {
        vscode.postMessage({ type: "reviewDiscardAll" });
      };
    }

    scrollToBottom();
  }

  function renderAttachmentsBar(files, images) {
    attachedContext = { files: files || [], images: images || [] };
    const hasFiles = files && files.length > 0;
    const hasImages = images && images.length > 0;
    if (!hasFiles && !hasImages) {
      attachmentsBar.classList.add("hidden");
      attachmentsBar.innerHTML = "";
      return;
    }

    attachmentsBar.classList.remove("hidden");
    attachmentsBar.innerHTML = "";

    const label = document.createElement("div");
    label.className = "attachments-label";
    label.textContent = "Attached:";
    attachmentsBar.appendChild(label);

    const list = document.createElement("div");
    list.className = "attachments-list";

    (files || []).forEach((file, index) => {
      const chip = document.createElement("div");
      chip.className = "attachment-chip file-chip";
      chip.innerHTML = "<span class=\"chip-icon\">📄</span><span class=\"chip-name\"></span>";
      chip.querySelector(".chip-name").textContent = file;
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "chip-remove";
      remove.textContent = "×";
      remove.title = "Remove";
      remove.onclick = () => vscode.postMessage({ type: "removeAttachment", kind: "file", index });
      chip.appendChild(remove);
      list.appendChild(chip);
    });

    (images || []).forEach((img, index) => {
      const chip = document.createElement("div");
      chip.className = "attachment-chip image-chip";
      const thumb = document.createElement("img");
      thumb.className = "attachment-thumb";
      thumb.src = img.dataUrl;
      thumb.alt = img.name;
      const name = document.createElement("span");
      name.className = "chip-name";
      name.textContent = img.name;
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "chip-remove";
      remove.textContent = "×";
      remove.title = "Remove";
      remove.onclick = () => vscode.postMessage({ type: "removeAttachment", kind: "image", index });
      chip.appendChild(thumb);
      chip.appendChild(name);
      chip.appendChild(remove);
      list.appendChild(chip);
    });

    attachmentsBar.appendChild(list);
    renderContextInspector();
  }

  function renderContextInspector() {
    if (!contextInspectorBody) return;
    const contextTotal = currentUsage.context || 0;
    const contextMax = currentUsage.max || 15000;
    const rows = [
      ["Current context", formatTokens(contextTotal) + " / " + formatTokens(contextMax)],
      ["Session usage", formatTokens(currentUsage.input + currentUsage.output) + " tokens"],
      ["Attached files", String(attachedContext.files.length)],
      ["Images", String(attachedContext.images.length)],
      ["Mode", currentMode.charAt(0).toUpperCase() + currentMode.slice(1)],
      ["Rules & skills", "Active when configured"]
    ];
    contextInspectorBody.innerHTML = rows.map(([label, value]) => '<div class="context-inspector-row"><span>' + label + '</span><strong>' + value + '</strong></div>').join("") +
      (attachedContext.files.length ? '<div class="context-file-list">' + attachedContext.files.map((file) => '<button type="button" class="file-ref" data-path="' + escapeHtml(file) + '">' + escapeHtml(file) + '</button>').join("") + '</div>' : '<div class="context-empty">No manually attached files</div>');
  }

  function showToast(message, kind = "info") {
    if (!toastRegion) return;
    const toast = document.createElement("div");
    toast.className = "toast " + kind;
    toast.textContent = message;
    toastRegion.appendChild(toast);
    requestAnimationFrame(() => toast.classList.add("visible"));
    setTimeout(() => { toast.classList.remove("visible"); setTimeout(() => toast.remove(), 180); }, 2200);
  }



  function showThinkingBubble(customText) {
    const defaultText = currentLang === "fa" ? "در حال پردازش و تحلیل کدهای پروژه" : "Thinking & processing";
    const text = customText || defaultText;
    if (!thinkingBubble) {
      thinkingBubble = document.createElement("div");
      thinkingBubble.className = "bubble assistant thinking";
      messagesEl.appendChild(thinkingBubble);
    }
    const tLower = text.toLowerCase();
    let icon = "⚡";
    if (text.includes("خواندن") || text.includes("مطالعه") || tLower.includes("read") || text.includes("فایل") || tLower.includes("file")) {
      icon = "📄";
    } else if (text.includes("جستجو") || tLower.includes("search")) {
      icon = "🔍";
    } else if (text.includes("ویرایش") || text.includes("اصلاح") || tLower.includes("patch") || tLower.includes("edit")) {
      icon = "✂️";
    } else if (text.includes("نوشتن") || text.includes("ذخیره") || text.includes("ایجاد") || tLower.includes("write")) {
      icon = "✏️";
    } else if (text.includes("ترمینال") || text.includes("دستور") || tLower.includes("command")) {
      icon = "▶️";
    } else if (text.includes("ساختار") || text.includes("پوشه") || text.includes("کاوش") || tLower.includes("list")) {
      icon = "🗂️";
    } else if (text.includes("تأیید") || text.includes("تایید") || tLower.includes("approval")) {
      icon = "⚠️";
    }
    thinkingBubble.innerHTML = `<span class="thinking-icon">${icon}</span> <span class="thinking-text">${escapeHtml(text)}</span><span class="dots"><span>.</span><span>.</span><span>.</span></span>`;
    setElementDirection(thinkingBubble, text);
    scrollToBottom();
  }

  function hideThinkingBubble() {
    if (!thinkingBubble) return;
    thinkingBubble.remove();
    thinkingBubble = null;
  }

  function setStreaming(active) {
    isStreamingActive = active;
    sendBtn.classList.toggle("hidden", active);
    stopBtn.classList.toggle("hidden", !active);
    attachBtn.disabled = active;
    if (attachTxtMdBtn) attachTxtMdBtn.disabled = active;
    if (attachActiveBtn) attachActiveBtn.disabled = active;
    if (active) {
      activityFooter?.classList.remove("hidden");
      if (activityFooterText) activityFooterText.textContent = currentMode === "plan" ? "Planning…" : "Working…";
      updateSessionStatus("running", currentLang === "fa" ? "در حال اجرا" : "Running");
      showThinkingBubble();
    } else {
      activityFooter?.classList.add("hidden");
      updateSessionStatus("completed", currentLang === "fa" ? "تکمیل شد" : "Completed");
      hideThinkingBubble();
    }
  }

  function updateSessionStatus(kind, label) {
    if (!sessionStatus || !sessionStatusText) return;
    sessionStatus.className = "session-status " + kind;
    sessionStatusText.textContent = label;
  }

  let planCollapsed = false;

  function renderTaskList(tasks) {
    if (!tasks || tasks.length === 0) {
      taskListEl.classList.add("hidden");
      taskListEl.innerHTML = "";
      return;
    }
    taskListEl.classList.remove("hidden");
    if (tasks.every((task) => task.status === "completed")) planCollapsed = true;
    taskListEl.innerHTML = "";

    const header = document.createElement("div");
    header.className = "tasklist-header";

    const titleWrap = document.createElement("div");
    titleWrap.className = "tasklist-title-wrap";

    const icon = document.createElement("span");
    icon.className = "tasklist-icon";
    icon.textContent = "📋";

    const done = tasks.filter((t) => t.status === "completed").length;
    const title = document.createElement("span");
    title.textContent = `Plan (${done}/${tasks.length})`;

    titleWrap.appendChild(icon);
    titleWrap.appendChild(title);

    const chevron = document.createElement("span");
    chevron.className = "tasklist-chevron" + (planCollapsed ? " collapsed" : "");
    chevron.textContent = "▾";

    header.appendChild(titleWrap);
    header.appendChild(chevron);

    const listBody = document.createElement("div");
    listBody.className = "tasklist-body" + (planCollapsed ? " collapsed" : "");

    header.onclick = () => {
      planCollapsed = !planCollapsed;
      chevron.classList.toggle("collapsed", planCollapsed);
      listBody.classList.toggle("collapsed", planCollapsed);
    };

    taskListEl.appendChild(header);

    for (const t of tasks) {
      const row = document.createElement("div");
      row.className = "task-row task-" + t.status;
      setElementDirection(row, t.content);
      row.textContent = `${statusIcon[t.status] || "\u25CB"} ${t.content}`;
      listBody.appendChild(row);
    }
    if (currentMode === "plan") {
      const planActions = document.createElement("div");
      planActions.className = "plan-actions";
      planActions.innerHTML = '<button type="button" data-edit-plan>Edit plan</button><button type="button" class="primary" data-implement-plan>Implement plan</button>';
      planActions.querySelector("[data-edit-plan]").onclick = () => { inputEl.value = "Revise the plan: "; autoResizeInput(); inputEl.focus(); };
      planActions.querySelector("[data-implement-plan]").onclick = () => {
        setModeUI("agent"); vscode.postMessage({ type: "setMode", mode: "agent" });
        inputEl.value = "Implement the approved plan."; formEl.requestSubmit();
      };
      listBody.appendChild(planActions);
    }
    taskListEl.appendChild(listBody);
  }

  formEl.addEventListener("submit", (e) => {
    e.preventDefault();
    const text = inputEl.value.trim();
    if (!text || isStreamingActive) return;
    hideMentionMenu();
    addUserBubble(text);
    currentAssistantBubble = null;
    currentAssistantRaw = "";
    inputEl.value = "";
    autoResizeInput();
    applyTextDirection("");
    setStreaming(true);
    showThinkingBubble("در حال پردازش پرامپت و تحلیل کانتکست / Preparing prompt...");
    vscode.postMessage({ type: "sendMessage", text });
  });

  inputEl.addEventListener("keydown", (e) => {
    const isMenuVisible = !mentionMenu.classList.contains("hidden");
    if (isMenuVisible) {
      if (e.key === "Escape") {
        hideMentionMenu();
        e.preventDefault();
        return;
      }
      if (e.key === "ArrowDown") {
        e.preventDefault();
        if (currentAutocompleteItems.length > 0) {
          activeAutocompleteIndex = (activeAutocompleteIndex + 1) % currentAutocompleteItems.length;
          updateActiveAutocompleteItem();
        }
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        if (currentAutocompleteItems.length > 0) {
          activeAutocompleteIndex =
            (activeAutocompleteIndex - 1 + currentAutocompleteItems.length) % currentAutocompleteItems.length;
          updateActiveAutocompleteItem();
        }
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        if (currentAutocompleteItems.length > 0 && activeAutocompleteIndex >= 0) {
          e.preventDefault();
          applyAutocompleteItem(currentAutocompleteItems[activeAutocompleteIndex]);
          return;
        }
      }
    }

    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      formEl.requestSubmit();
    }
  });

  inputEl.addEventListener("input", () => {
    autoResizeInput();
    applyTextDirection(inputEl.value);
    const val = inputEl.value;
    const cursor = inputEl.selectionStart;
    const before = val.slice(0, cursor);

    // 1. Slash command at start of input
    if (before.startsWith("/")) {
      autocompletePrefix = "/";
      const query = before.slice(1).toLowerCase();
      const filtered = SLASH_COMMAND_ITEMS.filter(
        (i) => i.label.toLowerCase().includes(query) || i.desc.toLowerCase().includes(query)
      );
      if (filtered.length > 0) {
        showAutocompleteMenu(filtered);
        return;
      }
    }

    // 2. Hash context variables
    const hashIndex = before.lastIndexOf("#");
    if (hashIndex >= 0 && (hashIndex === 0 || /\s/.test(before[hashIndex - 1]))) {
      const fragment = before.slice(hashIndex);
      if (fragment.startsWith("#file:")) {
        autocompletePrefix = "#file:";
        const fileQuery = fragment.slice(6);
        vscode.postMessage({ type: "searchWorkspaceFiles", query: fileQuery });
        return;
      } else {
        autocompletePrefix = "#";
        const filtered = HASH_CONTEXT_ITEMS.filter((i) =>
          i.label.toLowerCase().includes(fragment.toLowerCase())
        );
        if (filtered.length > 0) {
          showAutocompleteMenu(filtered);
          return;
        }
      }
    }

    // 3. @ mention
    const at = before.lastIndexOf("@");
    if (at >= 0 && (at === 0 || /\s/.test(before[at - 1]))) {
      const query = before.slice(at + 1);
      if (!/\s/.test(query)) {
        autocompletePrefix = "@";
        mentionStart = at;
        vscode.postMessage({ type: "searchMentions", query });
        return;
      }
    }

    hideMentionMenu();
  });

  sidebarNewBtn.addEventListener("click", () => {
    vscode.postMessage({ type: "newChat" });
  });

  document.getElementById("sidebar-toggle").addEventListener("click", () => {
    isSidebarCollapsed = !isSidebarCollapsed;
    sidebarEl.classList.toggle("collapsed", isSidebarCollapsed);
    vscode.setState({ ...(vscode.getState() || {}), sidebarCollapsed: isSidebarCollapsed });
  });

  attachBtn.addEventListener("click", () => {
    vscode.postMessage({ type: "attachFile" });
  });
  if (attachFolderBtn) attachFolderBtn.addEventListener("click", () => vscode.postMessage({ type: "attachFolder" }));

  if (attachTxtMdBtn) {
    attachTxtMdBtn.addEventListener("click", () => {
      vscode.postMessage({ type: "attachTxtMdFile" });
    });
  }

  if (attachActiveBtn) {
    attachActiveBtn.addEventListener("click", () => {
      vscode.postMessage({ type: "attachActiveFile" });
    });
  }

  const contextQuickBtn = document.getElementById("context-quick-btn");
  if (contextQuickBtn) {
    contextQuickBtn.addEventListener("click", () => {
      inputEl.value += (inputEl.value && !inputEl.value.endsWith(" ") ? " " : "") + "#";
      inputEl.dispatchEvent(new Event("input"));
      inputEl.focus();
    });
  }

  const slashQuickBtn = document.getElementById("slash-quick-btn");
  if (slashQuickBtn) {
    slashQuickBtn.addEventListener("click", () => {
      if (!inputEl.value.startsWith("/")) {
        inputEl.value = "/" + inputEl.value;
      }
      inputEl.dispatchEvent(new Event("input"));
      inputEl.focus();
    });
  }

  // Drag and Drop support on chatPane
  chatPane.addEventListener("dragover", (e) => {
    e.preventDefault();
    chatPane.classList.add("dragover");
    document.getElementById("drop-overlay")?.classList.remove("hidden");
  });
  chatPane.addEventListener("dragleave", () => {
    chatPane.classList.remove("dragover");
    document.getElementById("drop-overlay")?.classList.add("hidden");
  });
  chatPane.addEventListener("drop", async (e) => {
    e.preventDefault();
    chatPane.classList.remove("dragover");
    document.getElementById("drop-overlay")?.classList.add("hidden");
    if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      const paths = [];
      for (let i = 0; i < e.dataTransfer.files.length; i++) {
        const file = e.dataTransfer.files[i];
        if (file.path) { paths.push(file.path); continue; }
        if (file.type && file.type.startsWith("image/")) {
          const dataUrl = await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = () => reject(reader.error); reader.readAsDataURL(file); });
          vscode.postMessage({ type: "addImageData", dataUrl, name: file.name });
        } else {
          const content = await file.text();
          vscode.postMessage({ type: "addFileContent", name: file.name, content });
        }
      }
      if (paths.length > 0) {
        vscode.postMessage({ type: "addFilesByPath", paths });
      }
    }
  });

  stopBtn.addEventListener("click", () => {
    vscode.postMessage({ type: "stop" });
  });

  window.addEventListener("message", (event) => {
    const msg = event.data;
    switch (msg.type) {
      case "history":
        renderHistoryMessages(msg.messages);
        break;
      case "modeChanged":
        setModeUI(msg.mode);
        break;
      case "taskListUpdate":
        renderTaskList(msg.tasks);
        break;
      case "usage": {
        const contextTokens = msg.contextTokens || 0;
        const maxContext = msg.maxContextTokens || 15000;
        currentUsage = { input: msg.inputTokens || 0, output: msg.outputTokens || 0, context: contextTokens, max: maxContext };
        const percent = Math.min(100, Math.round((contextTokens / Math.max(maxContext, 1)) * 100));
        if (contextUsageBtn) {
          contextUsageBtn.textContent = `Context ${percent}%${percent >= 80 ? " ⚠" : ""}`;
          contextUsageBtn.classList.toggle("warning", percent >= 80);
          contextUsageBtn.title = `Current context ${formatTokens(contextTokens)} / ${formatTokens(maxContext)} estimated tokens`;
        }
        usageInfo.textContent =
          formatTokens(contextTokens) + " / " + formatTokens(maxContext) +
          " context  (session \u2191 " +
          formatTokens(msg.inputTokens || 0) +
          " \u2193 " +
          formatTokens(msg.outputTokens || 0) +
          ")";
        renderContextInspector();
        break;
      }
      case "contextCompacted":
        renderContextCompactCard("", msg);
        showToast(`Context compacted: ${formatTokens(msg.beforeTokens)} → ${formatTokens(msg.afterTokens)} tokens`);
        break;
      case "sessions":
        renderSessionList(msg.sessions, msg.currentId);
        break;
      case "mentionSuggestions":
        showMentionMenu(msg.items);
        break;
      case "streaming":
        setStreaming(msg.active);
        break;
      case "agentWorking":
        if (msg.active) {
          const defaultWorking = currentLang === "fa" ? "در حال کاوش و کار روی پروژه..." : "Working on workspace...";
          if (activityFooterText) activityFooterText.textContent = msg.statusText || defaultWorking;
          showThinkingBubble(msg.statusText || defaultWorking);
        } else {
          hideThinkingBubble();
        }
        break;
      case "promptProcessing":
        showThinkingBubble(msg.text || (currentLang === "fa" ? "در حال آماده‌سازی پرامپت..." : "Preparing prompt..."));
        break;
      case "attachmentsUpdated":
        renderAttachmentsBar(msg.files, msg.images);
        break;
      case "filesAttached":
        renderAttachmentsBar(msg.files, []);
        break;
      case "assistantTextDelta": {
        if (activeActivityCard && !activeActivityCard.isCompleted) {
          finalizeActiveActivityCard();
        }
        currentAssistantRaw += msg.text;
        const cleaned = sanitizeAssistantText(currentAssistantRaw);
        if (cleaned) {
          hideThinkingBubble();
          const bubble = ensureAssistantBubble();
          setElementDirection(bubble, cleaned);
          bubble.innerHTML = renderMarkdown(cleaned);
          scrollToBottom();
        }
        break;
      }
      case "activeTurnSync": {
        currentAssistantRaw = msg.text || "";
        const cleaned = sanitizeAssistantText(currentAssistantRaw);
        if (cleaned) {
          hideThinkingBubble();
          const bubble = ensureAssistantBubble();
          setElementDirection(bubble, cleaned);
          bubble.innerHTML = renderMarkdown(cleaned);
          scrollToBottom();
        }
        if (msg.isWorking) {
          showThinkingBubble();
        } else {
          hideThinkingBubble();
        }
        break;
      }
      case "assistantMessageDone":
        finalizeActiveActivityCard();
        if (currentAssistantRaw) {
          finalizeAssistantBubble(currentAssistantRaw);
        }
        hideThinkingBubble();
        currentAssistantBubble = null;
        currentAssistantRaw = "";
        if (currentMode === "agent" && messagesEl.querySelector(".agent-activity-card")) {
          const summary = document.createElement("div");
          summary.className = "completion-summary";
          const steps = messagesEl.querySelectorAll(".activity-step.ok").length;
          summary.innerHTML = '<span class="completion-icon">✓</span><span><strong>Task completed</strong><small>' + steps + ' tool step' + (steps === 1 ? '' : 's') + '</small></span><button type="button" data-review>Review changes</button>';
          summary.querySelector("[data-review]").onclick = () => vscode.postMessage({ type: "openReviewChanges" });
          messagesEl.appendChild(summary);
        }
        scrollToBottom();
        break;
      case "toolCall":
        hideThinkingBubble();
        if (currentAssistantBubble && currentAssistantRaw) {
          finalizeAssistantBubble(currentAssistantRaw);
          currentAssistantBubble = null;
          currentAssistantRaw = "";
        }
        addToolCard(msg.id, msg.name, msg.input);
        break;
      case "liveToolStart":
        hideThinkingBubble();
        addToolCard(msg.id, msg.name, {});
        break;
      case "liveToolStop":
        addToolCard(msg.id, msg.name, msg.input);
        break;
      case "toolResult":
        addToolResult(msg.id, msg.content, msg.isError);
        break;
      case "approvalRequest": {
        updateSessionStatus("waiting", currentLang === "fa" ? "نیازمند تایید" : "Approval required");
        approvalBanner.classList.remove("hidden");
        approvalBanner.innerHTML = "";

        const headerRow = document.createElement("div");
        headerRow.className = "approval-header-row";

        const iconSpan = document.createElement("span");
        iconSpan.className = "approval-icon";
        iconSpan.textContent = "⚠️";

        const label = document.createElement("span");
        label.className = "approval-label";
        const cleanDesc = (msg.description || "").replace(/\bundefined\b/g, currentLang === "fa" ? "نامشخص" : "unspecified");
        label.textContent = cleanDesc;

        headerRow.appendChild(iconSpan);
        headerRow.appendChild(label);
        approvalBanner.appendChild(headerRow);

        if (msg.diffPreview) {
          const diff = document.createElement("pre");
          diff.className = "approval-diff";
          diff.textContent = msg.diffPreview;
          approvalBanner.appendChild(diff);
        }

        const actions = document.createElement("div");
        actions.className = "approval-actions";

        if (msg.name === "search_replace" || msg.name === "write_file") {
          const parsedPath = cleanDesc.replace(/^.*:\s*/, "").trim();
          if (parsedPath && parsedPath !== "undefined" && !parsedPath.includes("unspecified") && !parsedPath.includes("نامشخص")) {
            const diffBtn = document.createElement("button");
            diffBtn.type = "button";
            diffBtn.className = "approval-btn approval-diff-btn";
            diffBtn.textContent = currentLang === "fa" ? "🔍 بررسی Diff" : "🔍 View Diff";
            diffBtn.onclick = () => {
              vscode.postMessage({ type: "openDiff", path: parsedPath });
            };
            actions.appendChild(diffBtn);
          }
        }

        const approveBtn = document.createElement("button");
        approveBtn.type = "button";
        approveBtn.className = "approval-btn approval-btn-allow";
        approveBtn.textContent = currentLang === "fa" ? "✓ تایید و اعمال" : "Allow";
        approveBtn.onclick = () => {
          vscode.postMessage({ type: "approvalResponse", id: msg.id, approved: true });
          approvalBanner.classList.add("hidden");
          updateSessionStatus("running", currentLang === "fa" ? "در حال اجرا" : "Running");
        };

        const denyBtn = document.createElement("button");
        denyBtn.type = "button";
        denyBtn.className = "approval-btn approval-btn-deny";
        denyBtn.textContent = currentLang === "fa" ? "✕ رد کردن" : "Deny";
        denyBtn.onclick = () => {
          vscode.postMessage({ type: "approvalResponse", id: msg.id, approved: false });
          approvalBanner.classList.add("hidden");
          updateSessionStatus("idle", currentLang === "fa" ? "رد شد" : "Denied");
        };

        const alwaysBtn = document.createElement("button");
        alwaysBtn.type = "button";
        alwaysBtn.className = "approval-btn approval-btn-always";
        alwaysBtn.textContent = currentLang === "fa" ? "⚡ تایید خودکار همیشگی" : "⚡ Always Auto-Approve";
        alwaysBtn.title = currentLang === "fa"
          ? (msg.name === "run_command" || msg.name === "run_in_terminal"
              ? "تایید و فعال‌سازی تایید خودکار برای همه دستورات ترمینال"
              : "تایید و فعال‌سازی تایید خودکار برای ویرایش‌های فایل")
          : "Approve and enable auto-approval permanently";
        alwaysBtn.onclick = () => {
          vscode.postMessage({ type: "approvalResponse", id: msg.id, approved: true, alwaysApprove: true });
          approvalBanner.classList.add("hidden");
        };

        actions.appendChild(approveBtn);
        actions.appendChild(alwaysBtn);
        actions.appendChild(denyBtn);
        approvalBanner.appendChild(actions);
        break;
      }
      case "fileReverted": {
        const normTarget = String(msg.path || "").trim().replace(/\\/g, "/");
        for (const entry of Object.values(toolCards)) {
          if (entry.step && entry.step.input && entry.step.input.path) {
            const stepPath = String(entry.step.input.path).trim().replace(/\\/g, "/");
            if (stepPath === normTarget) {
              entry.step.pill.textContent = currentLang === "fa" ? "↩️ بازگردانی شد" : "↩️ Reverted";
              entry.step.pill.className = "step-status-pill reverted";
            }
          }
        }
        break;
      }
      case "error": {
        const div = document.createElement("div");
        div.className = "error-card";
        div.innerHTML = '<div class="error-card-title"><span>!</span><strong>Request failed</strong></div><div class="error-card-message"></div><div class="error-card-actions"><button type="button" data-retry>Retry</button><button type="button" data-logs>View logs</button></div>';
        div.querySelector(".error-card-message").textContent = msg.message;
        div.querySelector("[data-retry]").onclick = () => vscode.postMessage({ type: "retryLastTurn" });
        div.querySelector("[data-logs]").onclick = () => vscode.postMessage({ type: "showLogs" });
        messagesEl.appendChild(div);
        updateSessionStatus("failed", "Failed");
        showToast("Request failed", "error");
        scrollToBottom();
        break;
      }
      case "settingsLoaded": {
        loadedSettings = msg.settings || {};
        populateSettings(msg.settings);
        const contextIndicator = document.getElementById("active-rules-indicator");
        if (contextIndicator) {
          const skillCount = Array.isArray(msg.settings.skills) ? msg.settings.skills.length : 0;
          let mcpCount = 0;
          try { mcpCount = Object.keys(JSON.parse(msg.settings.mcpServers || "{}")).length; } catch (_) {}
          contextIndicator.textContent = `${skillCount} Skills · MCP ${mcpCount}`;
          contextIndicator.title = "Active skills and MCP servers";
        }
        if (modelPicker) {
          const model = msg.settings.model || "claude-sonnet-5";
          modelPicker.innerHTML = "";
          const option = document.createElement("option"); option.value = model; option.textContent = model; modelPicker.appendChild(option);
          modelPicker.value = model;
        }
        if (permissionPicker) {
          permissionPicker.value = msg.settings.autoApproveCommands && msg.settings.autoApproveMode === "all" ? "full"
            : msg.settings.autoApproveMode === "all" ? "edit"
            : msg.settings.autoApproveMode === "safe" ? "safe" : "ask";
        }
        break;
      }
      case "modelsLoaded": {
        modelsLoading = false;
        modelsLoadedAt = Date.now();
        if (!modelPicker) break;
        const selected = msg.selectedModel || loadedSettings.model || "";
        const models = [selected, ...(msg.models || [])].filter((value, index, array) => value && array.indexOf(value) === index);
        modelPicker.innerHTML = "";
        models.forEach((value) => {
          const option = document.createElement("option"); option.value = value; option.textContent = value; modelPicker.appendChild(option);
        });
        modelPicker.value = selected;
        modelPicker.title = msg.error ? `Could not load /v1/models: ${msg.error}` : `${msg.models.length} models loaded from /v1/models`;
        modelPicker.classList.toggle("load-error", Boolean(msg.error));
        if (msg.error) showToast("Could not load model list; current model was preserved.", "error");
        break;
      }
      case "settingsSaved": {
        if (msg.success) {
          testConnStatus.className = "test-status ok";
          testConnStatus.textContent = "✓ " + (msg.message || "Saved");
          setTimeout(() => closeSettingsModal(), 800);
        } else {
          testConnStatus.className = "test-status error";
          testConnStatus.textContent = "✕ " + (msg.message || "Failed to save");
        }
        break;
      }
      case "testConnectionResult": {
        testConnStatus.className = "test-status " + (msg.ok ? "ok" : "error");
        testConnStatus.textContent = (msg.ok ? "✓ " : "✕ ") + msg.message;
        break;
      }
      case "apiUsageResult":
        renderApiUsage(msg);
        break;
      case "testMcpServersResult": {
        if (!testMcpStatus) break;
        const allOk = msg.statuses.every((s) => s.ok);
        testMcpStatus.className = "test-status " + (allOk ? "ok" : "error");
        testMcpStatus.innerHTML = msg.statuses
          .map((s) => `<div>${s.ok ? "✓" : "✕"} <b>${s.name}</b>: ${s.message}</div>`)
          .join("");
        break;
      }
      case "figmaAuthStatus": {
        updateFigmaStatusUI(msg.authenticated, msg.expiresAt, msg.error);
        break;
      }
      case "figmaAuthResult": {
        if (figmaAuthStatus) {
          figmaAuthStatus.className = "test-status " + (msg.success ? "ok" : "error");
          figmaAuthStatus.textContent = (msg.success ? "✓ " : "✕ ") + msg.message;
        }
        updateFigmaStatusUI(msg.authenticated);
        break;
      }
      case "skillsAdded": {
        configuredSkills = Array.isArray(msg.skills) ? msg.skills : configuredSkills;
        renderSkills();
        if (skillsStatus) {
          skillsStatus.className = "test-status ok";
          skillsStatus.textContent = "✓ " + msg.message;
        }
        break;
      }
      case "followUpPills": {
        renderFollowUpPills(msg.pills);
        break;
      }
      case "sessionReviewUpdate": {
        renderSessionReviewCard(msg.files);
        break;
      }
      case "searchWorkspaceFilesResult": {
        const fileItems = (msg.files || []).map((f) => ({
          label: f,
          desc: "فایل پروژه / Workspace file",
          insert: `#file:${f} `
        }));
        showAutocompleteMenu(fileItems);
        break;
      }
    }
  });

  // Settings Modal elements
  const settingsBtn = document.getElementById("settings-btn");
  const settingsModal = document.getElementById("settings-modal");
  const closeSettingsBtn = document.getElementById("close-settings-btn");
  const cancelSettingsBtn = document.getElementById("cancel-settings-btn");
  const saveSettingsBtn = document.getElementById("save-settings-btn");
  const testConnBtn = document.getElementById("test-conn-btn");
  const testConnStatus = document.getElementById("test-conn-status");
  const toggleKeyVisBtn = document.getElementById("toggle-key-visibility");
  const refreshUsageBtn = document.getElementById("refresh-usage-btn");
  const apiUsageContent = document.getElementById("api-usage-content");
  const apiUsageKey = document.getElementById("api-usage-key");

  const cfgApiFormat = document.getElementById("cfg-api-format");
  const cfgBaseUrl = document.getElementById("cfg-base-url");
  const cfgApiKey = document.getElementById("cfg-api-key");
  const cfgModel = document.getElementById("cfg-model");
  const cfgTemperature = document.getElementById("cfg-temperature");
  const cfgTempVal = document.getElementById("cfg-temp-val");
  const cfgMaxTokens = document.getElementById("cfg-max-tokens");
  const cfgToolProtocol = document.getElementById("cfg-tool-protocol");
  const cfgEnableTools = document.getElementById("cfg-enable-tools");
  const cfgEnableShell = document.getElementById("cfg-enable-shell");
  const cfgRequireApproval = document.getElementById("cfg-require-approval");
  const cfgAutoApproveCommands = document.getElementById("cfg-auto-approve-commands");
  const cfgAutoApproveMode = document.getElementById("cfg-auto-approve-mode");
  const cfgAutoIncludeActive = document.getElementById("cfg-auto-include-active");
  const cfgAutoCompact = document.getElementById("cfg-auto-compact");
  const cfgDebugLogging = document.getElementById("cfg-debug-logging");
  const cfgMcpServers = document.getElementById("cfg-mcp-servers");
  const cfgFigmaProxyEnabled = document.getElementById("cfg-figma-proxy-enabled");
  const cfgFigmaProxyUrl = document.getElementById("cfg-figma-proxy-url");
  const figmaLoginBtn = document.getElementById("figma-login-btn");
  const figmaLogoutBtn = document.getElementById("figma-logout-btn");
  const figmaDesktopBtn = document.getElementById("figma-desktop-btn");
  const figmaAuthBadge = document.getElementById("figma-auth-badge");
  const figmaAuthStatus = document.getElementById("figma-auth-status");
  const skillsList = document.getElementById("skills-list");
  const addSkillBtn = document.getElementById("add-skill-btn");
  const skillsStatus = document.getElementById("skills-status");
  const testMcpBtn = document.getElementById("test-mcp-btn");
  const testMcpStatus = document.getElementById("test-mcp-status");
  const copyLogsBtn = document.getElementById("copy-logs-btn");
  const showLogsBtn = document.getElementById("show-logs-btn");
  let configuredSkills = [];

  function usageNumber(value) {
    return typeof value === "number" && Number.isFinite(value) ? new Intl.NumberFormat(currentLang === "fa" ? "fa-IR" : "en-US").format(value) : "—";
  }
  function usageDate(value) {
    if (!value) return "—";
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString(currentLang === "fa" ? "fa-IR" : "en-US");
  }
  function addUsageMetric(parent, label, value) {
    const item = document.createElement("div"); item.className = "api-usage-metric";
    const title = document.createElement("span"); title.textContent = label;
    const result = document.createElement("strong"); result.textContent = value;
    item.append(title, result); parent.appendChild(item);
  }
  function renderApiUsage(msg) {
    if (!apiUsageContent) return;
    apiUsageContent.innerHTML = ""; apiUsageContent.className = "";
    if (refreshUsageBtn) refreshUsageBtn.disabled = false;
    if (!msg.ok || !msg.usage) {
      apiUsageContent.className = "api-usage-error";
      apiUsageContent.textContent = msg.message || "دریافت وضعیت مصرف ناموفق بود.";
      return;
    }
    const u = msg.usage;
    if (apiUsageKey) apiUsageKey.textContent = [u.key_name, u.key_masked].filter(Boolean).join(" · ");
    const meta = document.createElement("div"); meta.className = "api-usage-meta";
    [u.plan || "custom", u.status || "unknown", u.billing_mode || (u.managed === false ? "static" : "")].filter(Boolean).forEach((text) => {
      const badge = document.createElement("span"); badge.textContent = text; meta.appendChild(badge);
    });
    apiUsageContent.appendChild(meta);
    const metrics = document.createElement("div"); metrics.className = "api-usage-grid";
    if (u.billing_mode === "daily_usage" || (u.daily_limit || 0) > 0) {
      addUsageMetric(metrics, "مصرف امروز", usageNumber(u.used_today)); addUsageMetric(metrics, "باقی‌مانده امروز", usageNumber(u.remaining_today));
      addUsageMetric(metrics, "سقف روزانه", usageNumber(u.daily_limit)); addUsageMetric(metrics, "درصد مصرف", typeof u.usage_percent === "number" ? `${u.usage_percent.toFixed(1)}٪` : "—");
    } else {
      addUsageMetric(metrics, "Context آخرین درخواست", usageNumber(u.context?.last_request_used)); addUsageMetric(metrics, "ظرفیت Context", usageNumber(u.context?.limit ?? u.context_limit));
      addUsageMetric(metrics, "درصد Context", typeof u.context?.last_request_percent === "number" ? `${u.context.last_request_percent.toFixed(1)}٪` : "—"); addUsageMetric(metrics, "موجودی توکن", usageNumber(u.user_token_balance));
    }
    addUsageMetric(metrics, "کل درخواست‌ها", usageNumber(u.lifetime?.total_requests)); addUsageMetric(metrics, "کل توکن مصرفی", usageNumber(u.lifetime?.total_billable_tokens));
    apiUsageContent.appendChild(metrics);
    const details = document.createElement("div"); details.className = "api-usage-details";
    const model = u.last_request?.model ? `مدل آخرین درخواست: ${u.last_request.model}` : "هنوز درخواستی ثبت نشده";
    details.textContent = `${model} · زمان: ${usageDate(u.last_request?.created_at)}${u.expires_at ? ` · انقضای پلن: ${usageDate(u.expires_at)}` : ""}`;
    apiUsageContent.appendChild(details);
  }
  function requestApiUsage() {
    if (apiUsageContent) { apiUsageContent.className = "api-usage-loading"; apiUsageContent.textContent = "در حال دریافت وضعیت مصرف…"; }
    if (refreshUsageBtn) refreshUsageBtn.disabled = true;
    vscode.postMessage({ type: "requestApiUsage", tempSettings: { baseUrl: cfgBaseUrl ? cfgBaseUrl.value.trim() : "", apiKey: cfgApiKey ? cfgApiKey.value.trim() : "", apiFormat: cfgApiFormat ? cfgApiFormat.value : "anthropic" }});
  }

  function updateFigmaStatusUI(auth, expiresAt, error) {
    if (!figmaAuthBadge) return;
    if (auth) {
      figmaAuthBadge.className = "figma-badge connected";
      let expText = "";
      if (expiresAt) {
        try {
          const d = new Date(expiresAt);
          expText = ` (انقضا: ${d.toLocaleDateString("fa-IR")})`;
        } catch (_) {}
      }
      figmaAuthBadge.textContent = "🟢 متصل به اکانت فیگما" + expText;
      if (figmaLoginBtn) figmaLoginBtn.classList.add("hidden");
      if (figmaLogoutBtn) figmaLogoutBtn.classList.remove("hidden");
    } else {
      figmaAuthBadge.className = "figma-badge disconnected";
      figmaAuthBadge.textContent = error ? "⚠️ " + error : "⚪ اکانت متصل نیست";
      if (figmaLoginBtn) figmaLoginBtn.classList.remove("hidden");
      if (figmaLogoutBtn) figmaLogoutBtn.classList.add("hidden");
    }
  }

  function renderSkills() {
    if (!skillsList) return;
    skillsList.innerHTML = "";
    if (configuredSkills.length === 0) {
      const empty = document.createElement("div");
      empty.className = "skills-empty";
      empty.textContent = translations[currentLang].no_skills;
      skillsList.appendChild(empty);
      return;
    }
    configuredSkills.forEach((skill, index) => {
      const row = document.createElement("div");
      row.className = "skill-row";
      const label = document.createElement("span");
      label.className = "skill-path";
      label.textContent = typeof skill === "string" ? skill : (skill.name || skill.path);
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "skill-remove-btn";
      remove.title = translations[currentLang].remove_skill;
      remove.textContent = "×";
      remove.addEventListener("click", () => {
        configuredSkills.splice(index, 1);
        renderSkills();
      });
      row.appendChild(label);
      row.appendChild(remove);
      skillsList.appendChild(row);
    });
  }

  function openSettingsModal() {
    vscode.postMessage({ type: "getSettings" });
    settingsModal.classList.remove("hidden");
  }

  function closeSettingsModal() {
    settingsModal.classList.add("hidden");
    testConnStatus.textContent = "";
    testConnStatus.className = "test-status";
    if (testMcpStatus) {
      testMcpStatus.textContent = "";
      testMcpStatus.className = "test-status";
    }
    if (skillsStatus) {
      skillsStatus.textContent = "";
      skillsStatus.className = "test-status";
    }
  }

  function populateSettings(s) {
    if (!s) return;
    if (cfgApiFormat) cfgApiFormat.value = s.apiFormat || "anthropic";
    if (cfgBaseUrl) cfgBaseUrl.value = s.baseUrl || "";
    if (cfgApiKey) cfgApiKey.value = s.apiKey || "";
    if (cfgModel) cfgModel.value = s.model || "";
    if (cfgTemperature) {
      cfgTemperature.value = s.temperature ?? 1;
      if (cfgTempVal) cfgTempVal.textContent = Number(s.temperature ?? 1).toFixed(2);
    }
    if (cfgMaxTokens) cfgMaxTokens.value = s.maxTokens ?? 4096;
    if (cfgToolProtocol) cfgToolProtocol.value = s.toolProtocol || "auto";
    if (cfgEnableTools) cfgEnableTools.checked = s.enableTools ?? true;
    if (cfgEnableShell) cfgEnableShell.checked = s.enableShellTool ?? true;
    if (cfgRequireApproval) cfgRequireApproval.checked = s.requireApprovalForWrites ?? true;
    if (cfgAutoApproveCommands) cfgAutoApproveCommands.checked = Boolean(s.autoApproveCommands);
    if (cfgAutoApproveMode) cfgAutoApproveMode.value = s.autoApproveMode || "off";
    if (cfgAutoIncludeActive) cfgAutoIncludeActive.checked = s.autoIncludeActiveFile ?? true;
    if (cfgAutoCompact) cfgAutoCompact.checked = Boolean(s.experimentalAutoCompact);
    configuredSkills = Array.isArray(s.skills) ? s.skills.slice() : [];
    renderSkills();
    if (cfgDebugLogging) cfgDebugLogging.checked = Boolean(s.debugLogging);
    if (cfgMcpServers) cfgMcpServers.value = s.mcpServers || "{}";
    if (cfgFigmaProxyEnabled) cfgFigmaProxyEnabled.checked = Boolean(s.figmaProxyEnabled);
    if (cfgFigmaProxyUrl) cfgFigmaProxyUrl.value = s.figmaProxyUrl || "";
    settingsModal.classList.remove("hidden");
  }

  if (settingsBtn) {
    settingsBtn.addEventListener("click", openSettingsModal);
  }
  if (closeSettingsBtn) {
    closeSettingsBtn.addEventListener("click", closeSettingsModal);
  }
  if (cancelSettingsBtn) {
    cancelSettingsBtn.addEventListener("click", closeSettingsModal);
  }

  if (cfgTemperature && cfgTempVal) {
    cfgTemperature.addEventListener("input", () => {
      cfgTempVal.textContent = Number(cfgTemperature.value).toFixed(2);
    });
  }

  if (toggleKeyVisBtn && cfgApiKey) {
    toggleKeyVisBtn.addEventListener("click", () => {
      cfgApiKey.type = cfgApiKey.type === "password" ? "text" : "password";
      toggleKeyVisBtn.textContent = cfgApiKey.type === "password" ? "👁️" : "🙈";
    });
  }

  if (copyLogsBtn) {
    copyLogsBtn.addEventListener("click", () => {
      vscode.postMessage({ type: "copyLogs" });
      const orig = copyLogsBtn.textContent;
      copyLogsBtn.textContent = currentLang === "fa" ? "✓ کپی شد!" : "✓ Copied!";
      setTimeout(() => { copyLogsBtn.textContent = orig; }, 1800);
    });
  }

  if (showLogsBtn) {
    showLogsBtn.addEventListener("click", () => {
      vscode.postMessage({ type: "showLogs" });
    });
  }

  document.querySelectorAll(".model-chip").forEach((chip) => {
    chip.addEventListener("click", () => {
      const model = chip.getAttribute("data-model");
      const format = chip.getAttribute("data-format");
      if (model && cfgModel) cfgModel.value = model;
      if (format && cfgApiFormat) cfgApiFormat.value = format;
    });
  });

  if (testConnBtn) {
    testConnBtn.addEventListener("click", () => {
      testConnStatus.className = "test-status testing";
      testConnStatus.textContent = "Connecting / در حال آزمایش...";
      vscode.postMessage({
        type: "testConnection",
        tempSettings: {
          apiKey: cfgApiKey ? cfgApiKey.value.trim() : ""
        }
      });
    });
  }

  if (refreshUsageBtn) refreshUsageBtn.addEventListener("click", requestApiUsage);

  if (figmaLoginBtn) {
    figmaLoginBtn.addEventListener("click", () => {
      if (figmaAuthStatus) {
        figmaAuthStatus.className = "test-status testing";
        figmaAuthStatus.textContent = "در حال باز کردن مرورگر و انتظار برای تایید ورود در فیگما...";
      }
      vscode.postMessage({ type: "loginFigma" });
    });
  }

  if (figmaLogoutBtn) {
    figmaLogoutBtn.addEventListener("click", () => {
      if (figmaAuthStatus) {
        figmaAuthStatus.className = "test-status testing";
        figmaAuthStatus.textContent = "در حال خروج...";
      }
      vscode.postMessage({ type: "logoutFigma" });
    });
  }

  if (figmaDesktopBtn) {
    figmaDesktopBtn.addEventListener("click", () => {
      if (figmaAuthStatus) {
        figmaAuthStatus.className = "test-status testing";
        figmaAuthStatus.textContent = "در حال تنظیم سرور دسکتاپ...";
      }
      vscode.postMessage({ type: "configureFigmaDesktop" });
    });
  }

  if (testMcpBtn) {
    testMcpBtn.addEventListener("click", () => {
      testMcpStatus.className = "test-status testing";
      testMcpStatus.textContent = "Testing MCP servers / در حال تست سرورهای MCP...";
      vscode.postMessage({
        type: "testMcpServers",
        rawMcpServers: cfgMcpServers ? cfgMcpServers.value.trim() : undefined
      });
    });
  }

  if (addSkillBtn) {
    addSkillBtn.addEventListener("click", () => {
      if (skillsStatus) {
        skillsStatus.className = "test-status testing";
        skillsStatus.textContent = "Select skill files...";
      }
      vscode.postMessage({
        type: "addSkills",
        existingSkills: configuredSkills
      });
    });
  }

  if (saveSettingsBtn) {
    saveSettingsBtn.addEventListener("click", () => {
      testConnStatus.className = "test-status testing";
      testConnStatus.textContent = "Saving / در حال ذخیره...";
      vscode.postMessage({
        type: "saveSettings",
        settings: {
          apiFormat: cfgApiFormat ? cfgApiFormat.value : "anthropic",
          baseUrl: cfgBaseUrl ? cfgBaseUrl.value.trim() : "",
          apiKey: cfgApiKey ? cfgApiKey.value.trim() : "",
          model: cfgModel ? cfgModel.value.trim() : "",
          temperature: cfgTemperature ? parseFloat(cfgTemperature.value) : 1,
          maxTokens: cfgMaxTokens ? parseInt(cfgMaxTokens.value, 10) : 4096,
          toolProtocol: cfgToolProtocol ? cfgToolProtocol.value : "auto",
          enableTools: cfgEnableTools ? cfgEnableTools.checked : true,
          enableShellTool: cfgEnableShell ? cfgEnableShell.checked : true,
          requireApprovalForWrites: cfgRequireApproval ? cfgRequireApproval.checked : true,
          autoApproveCommands: cfgAutoApproveCommands ? cfgAutoApproveCommands.checked : false,
          autoApproveMode: cfgAutoApproveMode ? cfgAutoApproveMode.value : "off",
          requireApprovalForCommands: cfgAutoApproveCommands ? !cfgAutoApproveCommands.checked : true,
          autoIncludeActiveFile: cfgAutoIncludeActive ? cfgAutoIncludeActive.checked : true,
          experimentalAutoCompact: cfgAutoCompact ? cfgAutoCompact.checked : false,
          skills: configuredSkills,
          debugLogging: cfgDebugLogging ? cfgDebugLogging.checked : false,
          figmaProxyEnabled: cfgFigmaProxyEnabled ? cfgFigmaProxyEnabled.checked : false,
          figmaProxyUrl: cfgFigmaProxyUrl ? cfgFigmaProxyUrl.value.trim() : "",
          mcpServers: cfgMcpServers ? cfgMcpServers.value.trim() : "{}"
        }
      });
    });
  }

  // Event delegation for code-copy/insert buttons, prompt chips, and message actions
  messagesEl.addEventListener("click", (e) => {
    const fileRef = e.target.closest(".file-ref");
    if (fileRef) {
      vscode.postMessage({ type: "openFile", path: fileRef.dataset.path, line: Number(fileRef.dataset.line || 0) || undefined });
      return;
    }

    const runBtn = e.target.closest(".code-run-btn");
    if (runBtn) {
      const codeBlock = runBtn.closest(".code-block");
      const codeEl = codeBlock ? codeBlock.querySelector("code") : null;
      if (codeEl) {
        const cmdText = (codeEl.textContent || "").trim();
        if (cmdText) {
          vscode.postMessage({ type: "runInTerminal", command: cmdText });
          runBtn.innerHTML = "✓ Running...";
          runBtn.classList.add("running");
          setTimeout(() => {
            runBtn.innerHTML = "▶ Run";
            runBtn.classList.remove("running");
          }, 2000);
        }
      }
      return;
    }

    const copyBtn = e.target.closest(".code-copy-btn");
    if (copyBtn) {
      const codeBlock = copyBtn.closest(".code-block");
      const codeEl = codeBlock ? codeBlock.querySelector("code") : null;
      if (codeEl) {
        navigator.clipboard.writeText(codeEl.textContent || "").then(() => {
          copyBtn.innerHTML = "✓ Copied!";
          copyBtn.classList.add("copied");
          setTimeout(() => {
            copyBtn.innerHTML = "📋 Copy";
            copyBtn.classList.remove("copied");
          }, 1500);
        });
      }
      return;
    }

    const insertBtn = e.target.closest(".code-insert-btn");
    if (insertBtn) {
      const codeBlock = insertBtn.closest(".code-block");
      const codeEl = codeBlock ? codeBlock.querySelector("code") : null;
      if (codeEl) {
        vscode.postMessage({ type: "insertAtCursor", text: codeEl.textContent || "" });
        insertBtn.innerHTML = "✓ Inserted!";
        insertBtn.classList.add("inserted");
        setTimeout(() => {
          insertBtn.innerHTML = "⎘ Insert";
          insertBtn.classList.remove("inserted");
        }, 1500);
      }
      return;
    }

    const editMsgBtn = e.target.closest(".edit-msg-btn");
    if (editMsgBtn) {
      const wrap = editMsgBtn.closest(".msg-user-wrap");
      const bubble = wrap ? wrap.querySelector(".bubble.user") : null;
      if (bubble) {
        const raw = bubble.getAttribute("data-raw-text") || bubble.textContent || "";
        inputEl.value = raw.trim();
        autoResizeInput();
        applyTextDirection(raw);
        inputEl.focus();
      }
      return;
    }

    const copyMsgBtn = e.target.closest(".copy-msg-btn");
    if (copyMsgBtn) {
      const wrap = copyMsgBtn.closest(".msg-user-wrap");
      const bubble = wrap ? wrap.querySelector(".bubble.user") : null;
      if (bubble) {
        const raw = bubble.getAttribute("data-raw-text") || bubble.textContent || "";
        navigator.clipboard.writeText(raw.trim()).then(() => {
          copyMsgBtn.innerHTML = "✓";
          setTimeout(() => {
            copyMsgBtn.innerHTML = "📋";
          }, 1500);
        });
      }
      return;
    }

    const chip = e.target.closest(".prompt-chip");
    if (chip) {
      const prompt = chip.getAttribute("data-prompt");
      if (prompt) {
        inputEl.value = prompt;
        autoResizeInput();
        applyTextDirection(prompt);
        inputEl.focus();
      }
      return;
    }
  });

  if (settingsModal) {
    settingsModal.addEventListener("click", (e) => {
      if (e.target === settingsModal) {
        closeSettingsModal();
      }
    });
  }

  function openHelpModal() {
    if (helpModal) helpModal.classList.remove("hidden");
  }

  function closeHelpModal() {
    if (helpModal) helpModal.classList.add("hidden");
  }

  if (helpBtn) {
    helpBtn.addEventListener("click", openHelpModal);
  }
  if (closeHelpBtn) {
    closeHelpBtn.addEventListener("click", closeHelpModal);
  }
  if (closeHelpFooterBtn) {
    closeHelpFooterBtn.addEventListener("click", closeHelpModal);
  }
  if (helpModal) {
    helpModal.addEventListener("click", (e) => {
      if (e.target === helpModal) {
        closeHelpModal();
      }
    });
  }

  if (langBtn) {
    langBtn.addEventListener("click", () => {
      setLanguage(currentLang === "fa" ? "en" : "fa");
    });
  }

  if (modeAgentBtn) {
    modeAgentBtn.addEventListener("click", () => {
      setModeUI("agent");
      vscode.postMessage({ type: "setMode", mode: "agent" });
    });
  }

  if (modeChatBtn) {
    modeChatBtn.addEventListener("click", () => {
      setModeUI("ask");
      vscode.postMessage({ type: "setMode", mode: "ask" });
    });
  }

  if (modePlanBtn) {
    modePlanBtn.addEventListener("click", () => {
      setModeUI("plan");
      vscode.postMessage({ type: "setMode", mode: "plan" });
    });
  }

  if (modelPicker) {
    const refreshModels = () => {
      if (modelsLoading || Date.now() - modelsLoadedAt < 30_000) return;
      modelsLoading = true;
      modelPicker.title = "Loading models from /v1/models…";
      vscode.postMessage({ type: "requestModels" });
    };
    modelPicker.addEventListener("focus", refreshModels);
    modelPicker.addEventListener("pointerdown", refreshModels);
    modelPicker.addEventListener("change", () => {
      loadedSettings.model = modelPicker.value;
      vscode.postMessage({ type: "saveSettings", settings: { model: modelPicker.value } });
    });
  }

  if (permissionPicker) {
    permissionPicker.addEventListener("change", () => {
      const value = permissionPicker.value;
      const settings = value === "full"
        ? { autoApproveMode: "all", autoApproveCommands: true, requireApprovalForCommands: false, requireApprovalForWrites: false }
        : value === "edit"
          ? { autoApproveMode: "all", autoApproveCommands: false, requireApprovalForCommands: true, requireApprovalForWrites: false }
          : value === "safe"
            ? { autoApproveMode: "safe", autoApproveCommands: false, requireApprovalForCommands: true, requireApprovalForWrites: true }
            : { autoApproveMode: "off", autoApproveCommands: false, requireApprovalForCommands: true, requireApprovalForWrites: true };
      vscode.postMessage({ type: "saveSettings", settings });
    });
  }

  if (contextPickerBtn && contextPicker) {
    const closeContextPicker = () => { contextPicker.classList.add("hidden"); contextPickerBtn.setAttribute("aria-expanded", "false"); };
    contextPickerBtn.addEventListener("click", () => {
      const opening = contextPicker.classList.contains("hidden");
      sessionMenu?.classList.add("hidden");
      sessionMenuBtn?.setAttribute("aria-expanded", "false");
      contextInspector?.classList.add("hidden");
      contextUsageBtn?.setAttribute("aria-expanded", "false");
      contextPicker.classList.toggle("hidden", !opening);
      contextPickerBtn.setAttribute("aria-expanded", String(opening));
      if (opening) contextPicker.querySelector("button")?.focus();
    });
    contextPicker.addEventListener("click", (event) => {
      const button = event.target.closest("button[data-context]");
      if (!button) return;
      const kind = button.dataset.context;
      if (kind === "file") vscode.postMessage({ type: "attachFile" });
      else if (kind === "active") vscode.postMessage({ type: "attachActiveFile" });
      else {
        const aliases = { selection: "#selection", problems: "#problems", git: "#git", codebase: "#codebase" };
        inputEl.value += (inputEl.value && !inputEl.value.endsWith(" ") ? " " : "") + aliases[kind] + " ";
        inputEl.dispatchEvent(new Event("input")); inputEl.focus();
      }

      closeContextPicker();
    });
    contextPicker.addEventListener("keydown", (event) => {
      const buttons = Array.from(contextPicker.querySelectorAll("button"));
      const index = buttons.indexOf(document.activeElement);
      if (event.key === "Escape") { closeContextPicker(); contextPickerBtn.focus(); }
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        buttons[(index + (event.key === "ArrowDown" ? 1 : -1) + buttons.length) % buttons.length].focus();
      }
    });
  }

  if (contextUsageBtn && contextInspector) {
    contextUsageBtn.addEventListener("click", () => {
      renderContextInspector();
      sessionMenu?.classList.add("hidden");
      sessionMenuBtn?.setAttribute("aria-expanded", "false");
      contextPicker?.classList.add("hidden");
      contextPickerBtn?.setAttribute("aria-expanded", "false");
      const opening = contextInspector.classList.contains("hidden");
      contextInspector.classList.toggle("hidden", !opening);
      contextUsageBtn.setAttribute("aria-expanded", String(opening));
      if (opening) closeContextInspector?.focus();
    });
    closeContextInspector?.addEventListener("click", () => { contextInspector.classList.add("hidden"); contextUsageBtn.setAttribute("aria-expanded", "false"); contextUsageBtn.focus(); });
    contextInspector.addEventListener("click", (event) => {
      const ref = event.target.closest(".file-ref");
      if (ref) vscode.postMessage({ type: "openFile", path: ref.dataset.path });
    });
  }

  const requestStop = () => {
    if (!isStreamingActive) return;
    if (activityFooterText) activityFooterText.textContent = "Stopping…";
    updateSessionStatus("waiting", "Stopping…");
    vscode.postMessage({ type: "stop" });
  };
  activityStopBtn?.addEventListener("click", requestStop);

  if (sessionMenuBtn && sessionMenu) {
    const closeSessionMenu = () => { sessionMenu.classList.add("hidden"); sessionMenuBtn.setAttribute("aria-expanded", "false"); };
    sessionMenuBtn.addEventListener("click", () => {
      const opening = sessionMenu.classList.contains("hidden");
      contextPicker?.classList.add("hidden");
      contextPickerBtn?.setAttribute("aria-expanded", "false");
      contextInspector?.classList.add("hidden");
      contextUsageBtn?.setAttribute("aria-expanded", "false");
      sessionMenu.classList.toggle("hidden", !opening);
      sessionMenuBtn.setAttribute("aria-expanded", String(opening));
      if (opening) sessionMenu.querySelector("button")?.focus();
    });
    sessionMenu.addEventListener("click", (event) => {
      const action = event.target.closest("button[data-action]")?.dataset.action;
      if (!action) return;
      if (action === "new" || action === "clear") vscode.postMessage({ type: "newChat" });
      if (action === "history") vscode.postMessage({ type: "openHistory" });
      if (action === "settings") vscode.postMessage({ type: "openSettingsModal" });
      if (action === "rename" && currentSessionId) {
        vscode.postMessage({ type: "promptRenameSession", id: currentSessionId });
      }
      if (action === "delete" && currentSessionId) {
        vscode.postMessage({ type: "deleteSession", id: currentSessionId });
      }
      closeSessionMenu();
    });
    sessionMenu.addEventListener("keydown", (event) => {
      const buttons = Array.from(sessionMenu.querySelectorAll("button"));
      const index = buttons.indexOf(document.activeElement);
      if (event.key === "Escape") { closeSessionMenu(); sessionMenuBtn.focus(); }
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault(); buttons[(index + (event.key === "ArrowDown" ? 1 : -1) + buttons.length) % buttons.length].focus();
      }
    });
  }

  document.addEventListener("click", (event) => {
    if (sessionMenu && sessionMenuBtn && !sessionMenu.contains(event.target) && !sessionMenuBtn.contains(event.target)) {
      sessionMenu.classList.add("hidden"); sessionMenuBtn.setAttribute("aria-expanded", "false");
    }
    if (contextPicker && contextPickerBtn && !contextPicker.contains(event.target) && !contextPickerBtn.contains(event.target)) {
      contextPicker.classList.add("hidden"); contextPickerBtn.setAttribute("aria-expanded", "false");
    }
    if (contextInspector && contextUsageBtn && !contextInspector.contains(event.target) && !contextUsageBtn.contains(event.target)) {
      contextInspector.classList.add("hidden");
      contextUsageBtn.setAttribute("aria-expanded", "false");
    }
  });

  const TELEGRAM_URL = "https://t.me/lildevelop";
  const TELEGRAM_HANDLE = "@lildevelop";

  function setupTgAction(openButton, copyButton, iconId, textId) {
    if (openButton) {
      openButton.addEventListener("click", () => {
        vscode.postMessage({ type: "openExternal", url: TELEGRAM_URL });
      });
    }
    if (copyButton) {
      copyButton.addEventListener("click", () => {
        navigator.clipboard.writeText(TELEGRAM_HANDLE).then(() => {
          copyButton.classList.add("copied");
          const iconEl = iconId ? document.getElementById(iconId) : null;
          const textEl = textId ? document.getElementById(textId) : null;
          const origIcon = iconEl ? iconEl.textContent : "";
          const origText = textEl ? textEl.textContent : "";
          if (iconEl) iconEl.textContent = "✓";
          if (textEl) textEl.textContent = (translations[currentLang] || translations.fa).copied_text;
          setTimeout(() => {
            copyButton.classList.remove("copied");
            if (iconEl) iconEl.textContent = origIcon;
            if (textEl) textEl.textContent = origText;
          }, 1800);
        });
      });
    }
  }

  setupTgAction(openTgBtn, copyTgBtn, "copy-tg-icon", "copy-tg-text");
  setupTgAction(modalOpenTgBtn, modalCopyTgBtn, "modal-copy-tg-icon", "modal-copy-tg-text");

  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      if (settingsModal && !settingsModal.classList.contains("hidden")) {
        closeSettingsModal();
      }
      if (helpModal && !helpModal.classList.contains("hidden")) {
        closeHelpModal();
      }
    }
  });

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && !isStreamingActive) {
      vscode.postMessage({ type: "resync" });
    }
  });

  window.addEventListener("focus", () => {
    if (!isStreamingActive) {
      vscode.postMessage({ type: "resync" });
    }
  });

  vscode.postMessage({ type: "ready" });
  vscode.postMessage({ type: "getSettings" });
  vscode.postMessage({ type: "requestModels" });
  modelsLoading = true;
  setLanguage(currentLang);
  autoResizeInput();
  renderChatEmpty();
})();
