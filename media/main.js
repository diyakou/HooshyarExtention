(function () {
  const vscode = acquireVsCodeApi();
  const messagesEl = document.getElementById("messages");
  const formEl = document.getElementById("input-form");
  const inputEl = document.getElementById("input");
  const approvalBanner = document.getElementById("approval-banner");
  const taskListEl = document.getElementById("tasklist");
  const attachmentsBar = document.getElementById("attachments-bar");
  const attachBtn = document.getElementById("attach-btn");
  const sendBtn = document.getElementById("send-btn");
  const stopBtn = document.getElementById("stop-btn");
  const usageInfo = document.getElementById("usage-info");
  const sessionListEl = document.getElementById("session-list");
  const sidebarNewBtn = document.getElementById("sidebar-new-btn");
  const mentionMenu = document.getElementById("mention-menu");
  const chatPane = document.getElementById("chat-pane");

  let currentSessionId = "";
  let mentionStart = -1;

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
    "update_tasks",
    "search_replace",
    "run_command"
  ];

  function scrollToBottom() {
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  function autoResizeInput() {
    inputEl.style.height = "36px";
    inputEl.style.overflowY = "hidden";
    const next = Math.min(Math.max(inputEl.scrollHeight, 36), 190);
    inputEl.style.height = next + "px";
    inputEl.style.overflowY = next >= 190 ? "auto" : "hidden";
  }

  function renderChatEmpty() {
    if (messagesEl.querySelector(".chat-empty")) return;
    if (messagesEl.children.length > 0) return;
    const el = document.createElement("div");
    el.className = "chat-empty";
    el.innerHTML =
      "<h3>Hooshyar</h3>" +
      "<p>Ask anything about your project. The agent can read, search, and edit files in your workspace.</p>" +
      "<ul>" +
      "<li><code>@filename</code> attach a file</li>" +
      "<li>📎 attach an image (PNG/JPG/GIF/WebP)</li>" +
      "<li><code>@workspace</code> project context</li>" +
      "<li><code>@selection</code> current selection</li>" +
      "</ul>";
    messagesEl.appendChild(el);
  }

  function clearChatEmpty() {
    const el = messagesEl.querySelector(".chat-empty");
    if (el) el.remove();
  }

  // Removes tool-call markup so the user only sees natural language, even mid-stream
  // when a tag is only partially received.
  function sanitizeAssistantText(text) {
    let out = text;
    out = out.replace(/<tool_call>[\s\S]*?<\/tool_call>/g, "");
    out = out.replace(/<function>[\s\S]*?<\/function>/g, "");
    out = out.replace(/:::writing\{[^}]*\}\s*/g, "");
    for (const tool of KNOWN_TOOLS) {
      const re = new RegExp("<" + tool + ">[\\s\\S]*?<\\/" + tool + ">", "g");
      out = out.replace(re, "");
    }
    // Cut off any still-open (partially streamed) tool-call tag and everything after it.
    const openMarkers = ["<tool_call", "<function"];
    for (const tool of KNOWN_TOOLS) openMarkers.push("<" + tool + ">");
    let cut = -1;
    for (const marker of openMarkers) {
      const idx = out.indexOf(marker);
      if (idx !== -1 && (cut === -1 || idx < cut)) cut = idx;
    }
    if (cut !== -1) out = out.slice(0, cut);
    // Trailing partial like "<too" that could be the start of a tag.
    const lastLt = out.lastIndexOf("<");
    if (lastLt !== -1 && out.indexOf(">", lastLt) === -1 && /^<[\/a-zA-Z_]*$/.test(out.slice(lastLt))) {
      out = out.slice(0, lastLt);
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
    out = out.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
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
      if (inList) {
        html += "</ul>";
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
        html +=
          '<div class="code-block"><div class="code-lang">' +
          (fence[1] || "code") +
          '</div><pre><code>' +
          code.replace(/\n$/, "") +
          "</code></pre></div>";
        continue;
      }

      const h = line.match(/^(#{1,6})\s+(.*)$/);
      if (h) {
        closeList();
        html += '<div class="md-h md-h' + h[1].length + '">' + renderInline(h[2]) + "</div>";
        i++;
        continue;
      }

      const li = line.match(/^\s*[-*]\s+(.*)$/);
      if (li) {
        if (!inList) {
          html += "<ul>";
          inList = true;
        }
        html += "<li>" + renderInline(li[1]) + "</li>";
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
    const marker = "---\n\n";
    const idx = raw.lastIndexOf(marker);
    return idx >= 0 ? raw.slice(idx + marker.length).trim() : raw;
  }

  function isPersianText(text) {
    return /[\u0600-\u06FF]/.test(text);
  }

  function applyTextDirection(text) {
    const rtl = isPersianText(text);
    inputEl.dir = rtl ? "rtl" : "ltr";
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

  function renderHistoryMessages(messages) {
    messagesEl.innerHTML = "";
    for (const k of Object.keys(toolCards)) delete toolCards[k];
    currentAssistantBubble = null;
    currentAssistantRaw = "";

    for (const m of messages || []) {
      if (m.role === "user") {
        const text = userTextFromContent(m.content);
        const images =
          Array.isArray(m.content) ? m.content.filter((b) => b.type === "image") : [];
        const isToolResults =
          Array.isArray(m.content) &&
          m.content.length > 0 &&
          m.content.every((b) => b.type === "tool_result");
        if (isToolResults) continue;
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

      if (m.role === "assistant" && Array.isArray(m.content)) {
        const text = sanitizeAssistantText(
          m.content
            .filter((b) => b.type === "text")
            .map((b) => b.text)
            .join("")
        );
        if (text) {
          clearChatEmpty();
          const wrap = document.createElement("div");
          wrap.className = "assistant-wrap";
          const div = document.createElement("div");
          div.className = "bubble assistant";
          div.innerHTML = renderMarkdown(text);
          wrap.appendChild(div);
          addMessageActions(wrap, text);
          messagesEl.appendChild(wrap);
        }
        for (const b of m.content) {
          if (b.type === "tool_use") {
            clearChatEmpty();
            addToolCard(b.id, b.name, b.input || {});
            addToolResult(b.id, "(from history)", false);
          }
        }
      }
    }

    if (messagesEl.children.length === 0) renderChatEmpty();
    scrollToBottom();
  }

  function addMessageActions(wrap, text) {
    const actions = document.createElement("div");
    actions.className = "msg-actions";
    const copyBtn = document.createElement("button");
    copyBtn.type = "button";
    copyBtn.textContent = "Copy";
    copyBtn.onclick = () => navigator.clipboard.writeText(text);
    const insertBtn = document.createElement("button");
    insertBtn.type = "button";
    insertBtn.textContent = "Insert";
    insertBtn.onclick = () => vscode.postMessage({ type: "insertAtCursor", text });
    const retryBtn = document.createElement("button");
    retryBtn.type = "button";
    retryBtn.textContent = "Retry";
    retryBtn.onclick = () => vscode.postMessage({ type: "retryLastTurn" });
    actions.appendChild(copyBtn);
    actions.appendChild(insertBtn);
    actions.appendChild(retryBtn);
    wrap.appendChild(actions);
  }

  function finalizeAssistantBubble(text) {
    if (!currentAssistantBubble) return;
    const cleaned = sanitizeAssistantText(text);
    if (!cleaned) {
      currentAssistantBubble.remove();
      currentAssistantBubble = null;
      return;
    }
    const wrap = document.createElement("div");
    wrap.className = "assistant-wrap";
    const bubble = currentAssistantBubble;
    bubble.innerHTML = renderMarkdown(cleaned);
    wrap.appendChild(bubble);
    addMessageActions(wrap, cleaned);
    messagesEl.replaceChild(wrap, currentAssistantBubble);
    currentAssistantBubble = bubble;
  }

  function renderSessionList(sessions, currentId) {
    currentSessionId = currentId || "";
    const sidebar = document.getElementById("sidebar");
    sessionListEl.innerHTML = "";

    if (!sessions || sessions.length === 0) {
      sidebar.classList.add("collapsed");
      const empty = document.createElement("div");
      empty.className = "session-empty";
      empty.textContent = "No saved chats yet";
      sessionListEl.appendChild(empty);
      return;
    }

    sidebar.classList.remove("collapsed");
    for (const s of sessions) {
      const row = document.createElement("div");
      row.className = "session-row" + (s.id === currentId ? " active" : "");
      const title = document.createElement("span");
      title.className = "session-title";
      title.textContent = s.title || "(untitled)";
      title.title = s.title || "";
      title.onclick = () => vscode.postMessage({ type: "loadSession", id: s.id });
      const actions = document.createElement("span");
      actions.className = "session-actions";
      const renameBtn = document.createElement("button");
      renameBtn.type = "button";
      renameBtn.textContent = "\u270E";
      renameBtn.title = "Rename";
      renameBtn.onclick = (e) => {
        e.stopPropagation();
        const next = prompt("Rename chat", s.title || "");
        if (next !== null && next.trim()) {
          vscode.postMessage({ type: "renameSession", id: s.id, title: next.trim() });
        }
      };
      const delBtn = document.createElement("button");
      delBtn.type = "button";
      delBtn.textContent = "\u2715";
      delBtn.title = "Delete";
      delBtn.onclick = (e) => {
        e.stopPropagation();
        if (confirm("Delete this chat?")) {
          vscode.postMessage({ type: "deleteSession", id: s.id });
        }
      };
      actions.appendChild(renameBtn);
      actions.appendChild(delBtn);
      row.appendChild(title);
      row.appendChild(actions);
      sessionListEl.appendChild(row);
    }
  }

  function hideMentionMenu() {
    mentionMenu.classList.add("hidden");
    mentionMenu.innerHTML = "";
    mentionStart = -1;
  }

  function showMentionMenu(items) {
    mentionMenu.innerHTML = "";
    if (!items || items.length === 0) {
      hideMentionMenu();
      return;
    }
    mentionMenu.classList.remove("hidden");
    for (const item of items) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "mention-item";
      btn.textContent = item.label || item.path;
      btn.onclick = () => {
        const val = inputEl.value;
        const before = val.slice(0, mentionStart);
        const after = val.slice(inputEl.selectionStart);
        inputEl.value = before + "@" + item.path + " " + after;
        hideMentionMenu();
        inputEl.focus();
        autoResizeInput();
      };
      mentionMenu.appendChild(btn);
    }
  }

  function renderAttachmentsBar(files, images) {
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
  }

  function addUserBubble(text) {
    clearChatEmpty();
    const div = document.createElement("div");
    div.className = "bubble user";
    div.textContent = displayUserText(text);
    applyTextDirection(div.textContent);
    messagesEl.appendChild(div);
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

  const TOOL_META = {
    read_file: { icon: "\uD83D\uDCC4", verb: "Read" },
    write_file: { icon: "\u270F\uFE0F", verb: "Edit" },
    list_files: { icon: "\uD83D\uDCC1", verb: "List" },
    list_codebase: { icon: "\uD83D\uDDC2\uFE0F", verb: "Explore" },
    search_codebase: { icon: "\uD83D\uDD0D", verb: "Search" },
    search_replace: { icon: "\u2702\uFE0F", verb: "Patch" },
    update_tasks: { icon: "\u2705", verb: "Plan" },
    run_command: { icon: "\u25B6\uFE0F", verb: "Run" }
  };

  function friendlyToolLabel(name, input) {
    input = input || {};
    switch (name) {
      case "read_file":
        return "Read " + (input.path || "file");
      case "write_file":
        return "Edit " + (input.path || "file");
      case "list_files":
        return "List " + (input.path || ".");
      case "list_codebase":
        return "Explore project" + (input.path ? " · " + input.path : "");
      case "search_codebase":
        return 'Search "' + (input.pattern || "") + '"';
      case "search_replace":
        return "Patch " + (input.path || "file");
      case "update_tasks":
        return "Update plan";
      case "run_command":
        return "Run: " + (input.command || "");
      default:
        return name;
    }
  }

  function summarizeResult(name, content, isError) {
    if (isError) return "error";
    const trimmed = (content || "").trim();
    if (!trimmed) return "done";
    if (/^\(no files found\)$/i.test(trimmed) || /^\(empty directory\)$/i.test(trimmed)) return "empty";
    if (/^no matches found\.?$/i.test(trimmed)) return "no matches";
    const lines = trimmed.split("\n").length;
    if (name === "search_codebase") return lines + " match" + (lines === 1 ? "" : "es");
    if (name === "list_codebase" || name === "list_files") return lines + " item" + (lines === 1 ? "" : "s");
    if (name === "read_file") return lines + " line" + (lines === 1 ? "" : "s");
    if (name === "write_file") return "saved";
    if (name === "search_replace") return "patched";
    return lines + " line" + (lines === 1 ? "" : "s");
  }

  function formatInput(input) {
    if (!input || Object.keys(input).length === 0) return "";
    return Object.keys(input)
      .map((k) => k + ": " + (typeof input[k] === "string" ? input[k] : JSON.stringify(input[k])))
      .join("\n");
  }

  function addToolCard(id, name, input) {
    const meta = TOOL_META[name] || { icon: "\uD83D\uDD27", verb: name };

    const card = document.createElement("div");
    card.className = "tool-card collapsed";

    const header = document.createElement("div");
    header.className = "tool-card-header";

    const icon = document.createElement("span");
    icon.className = "tool-icon";
    icon.textContent = meta.icon;

    const label = document.createElement("span");
    label.className = "tool-label";
    label.textContent = friendlyToolLabel(name, input);

    const badge = document.createElement("span");
    badge.className = "tool-badge running";
    badge.textContent = "\u2026";

    const chevron = document.createElement("span");
    chevron.className = "tool-chevron";
    chevron.textContent = "\u203A";

    header.appendChild(icon);
    header.appendChild(label);
    header.appendChild(badge);
    header.appendChild(chevron);

    const body = document.createElement("div");
    body.className = "tool-card-body";

    const inputText = formatInput(input);
    if (inputText) {
      const inSection = document.createElement("pre");
      inSection.className = "tool-section";
      inSection.textContent = inputText;
      body.appendChild(inSection);
    }

    header.addEventListener("click", () => card.classList.toggle("collapsed"));

    card.appendChild(header);
    card.appendChild(body);
    messagesEl.appendChild(card);
    scrollToBottom();

    toolCards[id] = { card, body, badge, name };
  }

  function addToolResult(id, content, isError) {
    let entry = toolCards[id];
    if (!entry) {
      addToolCard(id, "result", {});
      entry = toolCards[id];
    }

    entry.badge.classList.remove("running");
    entry.badge.classList.add(isError ? "error" : "ok");
    entry.badge.textContent = summarizeResult(entry.name, content, isError);

    const resultPre = document.createElement("pre");
    resultPre.className = "tool-section tool-result-section" + (isError ? " error" : "");
    resultPre.textContent = (content || "").trim() || "(no output)";
    entry.body.appendChild(resultPre);
    scrollToBottom();
  }

  function showThinkingBubble() {
    if (thinkingBubble) return;
    thinkingBubble = document.createElement("div");
    thinkingBubble.className = "bubble assistant thinking";
    thinkingBubble.innerHTML = 'Thinking<span class="dots"><span>.</span><span>.</span><span>.</span></span>';
    messagesEl.appendChild(thinkingBubble);
    scrollToBottom();
  }

  function hideThinkingBubble() {
    if (!thinkingBubble) return;
    thinkingBubble.remove();
    thinkingBubble = null;
  }

  function setStreaming(active) {
    sendBtn.classList.toggle("hidden", active);
    stopBtn.classList.toggle("hidden", !active);
    attachBtn.disabled = active;
    if (active) {
      showThinkingBubble();
    } else {
      hideThinkingBubble();
    }
  }

  function renderTaskList(tasks) {
    if (!tasks || tasks.length === 0) {
      taskListEl.classList.add("hidden");
      taskListEl.innerHTML = "";
      return;
    }
    taskListEl.classList.remove("hidden");
    taskListEl.innerHTML = "";
    const header = document.createElement("div");
    header.className = "tasklist-header";
    const done = tasks.filter((t) => t.status === "completed").length;
    header.textContent = `Plan (${done}/${tasks.length})`;
    taskListEl.appendChild(header);
    for (const t of tasks) {
      const row = document.createElement("div");
      row.className = "task-row task-" + t.status;
      row.textContent = `${statusIcon[t.status] || "\u25CB"} ${t.content}`;
      taskListEl.appendChild(row);
    }
  }

  formEl.addEventListener("submit", (e) => {
    e.preventDefault();
    const text = inputEl.value.trim();
    if (!text) return;
    hideMentionMenu();
    addUserBubble(text);
    currentAssistantBubble = null;
    currentAssistantRaw = "";
    inputEl.value = "";
    autoResizeInput();
    applyTextDirection("");
    vscode.postMessage({ type: "sendMessage", text });
  });

  inputEl.addEventListener("keydown", (e) => {
    if (mentionStart >= 0 && e.key === "Escape") {
      hideMentionMenu();
      return;
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
    const at = before.lastIndexOf("@");
    if (at >= 0 && (at === 0 || /\s/.test(before[at - 1]))) {
      const query = before.slice(at + 1);
      if (!/\s/.test(query)) {
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
    document.getElementById("sidebar").classList.toggle("collapsed");
  });

  attachBtn.addEventListener("click", () => {
    vscode.postMessage({ type: "attachFile" });
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
      case "taskListUpdate":
        renderTaskList(msg.tasks);
        break;
      case "usage": {
        const total = (msg.inputTokens || 0) + (msg.outputTokens || 0);
        usageInfo.textContent =
          formatTokens(total) +
          " tokens  (\u2191 " +
          formatTokens(msg.inputTokens || 0) +
          " \u2193 " +
          formatTokens(msg.outputTokens || 0) +
          ")";
        break;
      }
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
        if (msg.active) showThinkingBubble();
        else hideThinkingBubble();
        break;
      case "attachmentsUpdated":
        renderAttachmentsBar(msg.files, msg.images);
        break;
      case "filesAttached":
        renderAttachmentsBar(msg.files, []);
        break;
      case "assistantTextDelta": {
        currentAssistantRaw += msg.text;
        const cleaned = sanitizeAssistantText(currentAssistantRaw);
        if (cleaned) {
          hideThinkingBubble();
          ensureAssistantBubble().innerHTML = renderMarkdown(cleaned);
          scrollToBottom();
        }
        break;
      }
      case "assistantMessageDone":
        finalizeAssistantBubble(currentAssistantRaw);
        hideThinkingBubble();
        currentAssistantBubble = null;
        currentAssistantRaw = "";
        break;
      case "toolCall":
        hideThinkingBubble();
        addToolCard(msg.id, msg.name, msg.input);
        break;
      case "toolResult":
        addToolResult(msg.id, msg.content, msg.isError);
        break;
      case "approvalRequest": {
        approvalBanner.classList.remove("hidden");
        approvalBanner.innerHTML = "";
        const label = document.createElement("span");
        label.textContent = msg.description;
        approvalBanner.appendChild(label);
        if (msg.diffPreview) {
          const diff = document.createElement("pre");
          diff.className = "approval-diff";
          diff.textContent = msg.diffPreview;
          approvalBanner.appendChild(diff);
        }
        const approveBtn = document.createElement("button");
        approveBtn.textContent = "Allow";
        approveBtn.onclick = () => {
          vscode.postMessage({ type: "approvalResponse", id: msg.id, approved: true });
          approvalBanner.classList.add("hidden");
        };
        const denyBtn = document.createElement("button");
        denyBtn.textContent = "Deny";
        denyBtn.onclick = () => {
          vscode.postMessage({ type: "approvalResponse", id: msg.id, approved: false });
          approvalBanner.classList.add("hidden");
        };
        const actions = document.createElement("div");
        actions.className = "approval-actions";
        actions.appendChild(approveBtn);
        actions.appendChild(denyBtn);
        approvalBanner.appendChild(actions);
        break;
      }
      case "error": {
        const div = document.createElement("div");
        div.className = "bubble error";
        div.textContent = "Error: " + msg.message;
        messagesEl.appendChild(div);
        scrollToBottom();
        break;
      }
    }
  });

  vscode.postMessage({ type: "ready" });
  autoResizeInput();
  renderChatEmpty();
})();
