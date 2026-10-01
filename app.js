/**
 * 瑯琊討論區・風雲思辨閣 主邏輯引擎 (app.js)
 * 驅動論壇研讀、原著對照、沙盤推演、闢謠考證、科舉考典、思辨民調與金句收納
 */

(function () {
  "use strict";

  // 全域應用狀態
  const State = {
    activeTab: "threads",
    selectedCategory: "all",
    searchKeyword: "",
    fontSize: 16,
    darkMode: false,
    soundEnabled: true,
    activeThreadId: null,
    selectedRoleAvatar: "mei_changsu",
    
    // 科舉考試狀態
    quiz: {
      currentIndex: 0,
      selectedAnswer: null,
      isAnswered: false,
      score: 0,
      userAnswers: [],
      finished: false
    },
    
    // 沙盤推演狀態 (各模擬器的分支選擇)
    simSelections: {
      "sim-1": { statePower: 95, ruleOfLaw: 90, monarchTrust: 40, borderSecurity: 98, step: 0 },
      "sim-2": { statePower: 45, ruleOfLaw: 20, monarchTrust: 50, borderSecurity: 55, step: 0 },
      "sim-3": { statePower: 80, ruleOfLaw: 85, monarchTrust: 75, borderSecurity: 70, step: 0 }
    },

    // 本地持久化資料 (點贊、自訂帖子、評論、民調投票、書籤)
    likes: {},
    pollVotes: {},
    customThreads: [],
    customReplies: {},
    bookmarkedQuotes: []
  };

  // 音效合成器 (Web Audio API)
  const SoundFX = {
    ctx: null,
    init: function () {
      if (!this.ctx && (window.AudioContext || window.webkitAudioContext)) {
        const AudioContext = window.AudioContext || window.webkitAudioContext;
        this.ctx = new AudioContext();
      }
    },
    playTone: function (freq = 440, type = "sine", duration = 0.2, gainVal = 0.08) {
      if (!State.soundEnabled) return;
      try {
        this.init();
        if (!this.ctx) return;
        if (this.ctx.state === "suspended") this.ctx.resume();

        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = type;
        osc.frequency.setValueAtTime(freq, this.ctx.currentTime);
        gain.gain.setValueAtTime(gainVal, this.ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.0001, this.ctx.currentTime + duration);

        osc.connect(gain);
        gain.connect(this.ctx.destination);
        osc.start();
        osc.stop(this.ctx.currentTime + duration);
      } catch (e) {
        // 音頻被策略攔截時靜默失敗
      }
    },
    playChime: function () {
      this.playTone(523.25, "sine", 0.35, 0.06); // C5
      setTimeout(() => this.playTone(659.25, "sine", 0.35, 0.05), 90); // E5
      setTimeout(() => this.playTone(783.99, "sine", 0.45, 0.05), 180); // G5
    },
    playClick: function () {
      this.playTone(392.00, "triangle", 0.1, 0.04);
    },
    playSuccess: function () {
      this.playTone(587.33, "sine", 0.25, 0.06);
      setTimeout(() => this.playTone(880.00, "sine", 0.4, 0.07), 120);
    }
  };

  // 本地快取載入與儲存
  function loadStorage() {
    try {
      const savedLikes = localStorage.getItem("langya_likes");
      if (savedLikes) State.likes = JSON.parse(savedLikes);

      const savedVotes = localStorage.getItem("langya_poll_votes");
      if (savedVotes) State.pollVotes = JSON.parse(savedVotes);

      const savedThreads = localStorage.getItem("langya_custom_threads");
      if (savedThreads) State.customThreads = JSON.parse(savedThreads);

      const savedReplies = localStorage.getItem("langya_custom_replies");
      if (savedReplies) State.customReplies = JSON.parse(savedReplies);

      const savedDark = localStorage.getItem("langya_dark_mode");
      if (savedDark !== null) State.darkMode = savedDark === "true";

      const savedFont = localStorage.getItem("langya_font_size");
      if (savedFont) State.fontSize = parseInt(savedFont, 10);
    } catch (e) {
      console.warn("LocalStorage 存取受限：", e);
    }
  }

  function saveStorage(key, data) {
    try {
      localStorage.setItem(key, JSON.stringify(data));
    } catch (e) {
      console.warn("LocalStorage 保存失敗：", e);
    }
  }

  // 浮動提示 Toast
  function showToast(msg, icon = "📜") {
    let toast = document.getElementById("langyaToast");
    if (!toast) {
      toast = document.createElement("div");
      toast.id = "langyaToast";
      toast.className = "toast-notice";
      document.body.appendChild(toast);
    }
    toast.innerHTML = `<span>${icon}</span> <span>${msg}</span>`;
    toast.classList.add("show");
    SoundFX.playTone(600, "sine", 0.15, 0.04);
    setTimeout(() => {
      toast.classList.remove("show");
    }, 2800);
  }

  // 取得全部帖子（內置 + 使用者自發布）
  function getAllThreads() {
    const defaultThreads = window.LangyaData.threads || [];
    return [...State.customThreads, ...defaultThreads];
  }

  // 渲染主題分類標籤
  function renderCategoryTags() {
    const container = document.getElementById("categoryTagsList");
    if (!container) return;

    const categories = window.LangyaData.categories || [];
    container.innerHTML = categories.map(cat => {
      const activeClass = State.selectedCategory === cat.id ? "active" : "";
      return `
        <button class="category-tag-btn ${activeClass}" data-cat="${cat.id}">
          <span>${cat.icon}</span>
          <span>${cat.name}</span>
        </button>
      `;
    }).join("");

    container.querySelectorAll(".category-tag-btn").forEach(btn => {
      btn.addEventListener("click", function () {
        State.selectedCategory = this.getAttribute("data-cat");
        SoundFX.playClick();
        renderCategoryTags();
        renderThreadsList();
      });
    });
  }

  // 渲染討論帖卡片列表
  function renderThreadsList() {
    const container = document.getElementById("threadsGrid");
    if (!container) return;

    let threads = getAllThreads();

    // 分類過濾
    if (State.selectedCategory !== "all") {
      threads = threads.filter(t => t.categoryId === State.selectedCategory);
    }

    // 關鍵字搜尋過濾
    if (State.searchKeyword.trim() !== "") {
      const q = State.searchKeyword.toLowerCase().trim();
      threads = threads.filter(t => {
        const titleMatch = t.title.toLowerCase().includes(q);
        const summaryMatch = t.summary.toLowerCase().includes(q);
        const tagsMatch = t.tags && t.tags.some(tag => tag.toLowerCase().includes(q));
        const quoteMatch = t.quote && t.quote.toLowerCase().includes(q);
        return titleMatch || summaryMatch || tagsMatch || quoteMatch;
      });
    }

    if (threads.length === 0) {
      container.innerHTML = `
        <div style="grid-column: 1 / -1; text-align: center; padding: 3rem 1rem; color: var(--text-muted); background: var(--bg-card); border-radius: 8px; border: 1px dashed var(--border-strong);">
          <div style="font-size: 2.5rem; margin-bottom: 0.5rem;">🔍</div>
          <div style="font-size: 1.1rem; font-weight: 700; margin-bottom: 0.3rem;">未尋得相應的瑯琊卷宗</div>
          <p style="font-size: 0.88rem;">請嘗試更換檢索詞（如：冰續丹、紀王、佛牙、景琰、雪蚧蟲、庭生）或切換分類標籤</p>
        </div>
      `;
      return;
    }

    const categoriesMap = (window.LangyaData.categories || []).reduce((acc, cur) => {
      acc[cur.id] = cur;
      return acc;
    }, {});

    container.innerHTML = threads.map(thread => {
      const cat = categoriesMap[thread.categoryId] || { name: "經典研討", icon: "📜" };
      const currentLikes = (thread.likes || 0) + (State.likes[thread.id] ? 1 : 0);
      const isLiked = !!State.likes[thread.id];
      const customRepliesCount = (State.customReplies[thread.id] || []).length;
      const totalReplies = (thread.replies ? thread.replies.length : 0) + customRepliesCount;

      return `
        <article class="thread-card" data-thread-id="${thread.id}">
          <div>
            <div class="thread-header">
              <span class="thread-category-badge">
                ${cat.icon} ${cat.name}
              </span>
              ${thread.badge ? `<span class="thread-highlight-badge">${thread.badge}</span>` : ""}
            </div>

            <h3 class="thread-title font-serif-tc" onclick="window.App.openThreadDetail('${thread.id}')">
              ${thread.title}
            </h3>

            <p class="thread-summary">${thread.summary}</p>

            ${thread.quote ? `
              <div class="thread-quote-preview">
                “${thread.quote}”
              </div>
            ` : ""}

            <div class="thread-tags">
              ${(thread.tags || []).map(t => `<span class="thread-tag-pill">#${t}</span>`).join("")}
            </div>
          </div>

          <div class="thread-footer">
            <div class="thread-author-info">
              <span class="author-avatar-badge">${(thread.author || "墨")[0]}</span>
              <span>${thread.author || "瑯琊墨客"}</span>
            </div>

            <div class="thread-actions-bar">
              <button class="action-stat-btn" onclick="window.App.toggleLike('${thread.id}', event)" title="靈犀點讚">
                <span>${isLiked ? "❤️" : "🤍"}</span>
                <span>${currentLikes}</span>
              </button>
              <button class="action-stat-btn" onclick="window.App.openThreadDetail('${thread.id}')" title="回帖探討">
                <span>💬</span>
                <span>${totalReplies}</span>
              </button>
              <button class="btn-read-detail" onclick="window.App.openThreadDetail('${thread.id}')">
                開卷研讀 →
              </button>
            </div>
          </div>
        </article>
      `;
    }).join("");
  }

  // 打開帖子詳情彈窗
  function openThreadDetail(threadId) {
    const thread = getAllThreads().find(t => t.id === threadId);
    if (!thread) return;

    State.activeThreadId = threadId;
    const modal = document.getElementById("threadDetailModal");
    const titleEl = document.getElementById("modalDetailTitle");
    const metaEl = document.getElementById("modalDetailMeta");
    const bodyEl = document.getElementById("modalDetailBody");

    SoundFX.playChime();

    titleEl.textContent = thread.title;
    metaEl.innerHTML = `
      <span>作者：${thread.author || "瑯琊墨客"}</span> • 
      <span>依據：${thread.publishChapter || "原著全篇"}</span> • 
      <span>${thread.pdfOrigin || "55頁研討精萃"}</span>
    `;

    // 彙整全部回覆
    const defaultReplies = thread.replies || [];
    const customReplies = State.customReplies[thread.id] || [];
    const allReplies = [...defaultReplies, ...customReplies];

    const roles = window.LangyaData.roleAvatars || [];

    bodyEl.innerHTML = `
      ${thread.quote ? `
        <div class="detail-quote-box">
          “${thread.quote}”
        </div>
      ` : ""}

      <div style="font-size: 1.02rem; margin-bottom: 1.6rem; color: var(--text-main); font-weight: 500;">
        ${thread.summary}
      </div>

      <div class="detail-points-wrapper">
        ${(thread.keyPoints || []).map(kp => `
          <div class="detail-point-card">
            <h4 class="font-serif-tc">${kp.heading}</h4>
            <p style="font-size: 0.94rem; color: var(--text-main); line-height: 1.8;">${kp.content}</p>
          </div>
        `).join("")}
      </div>

      ${thread.aiDebunkNote ? `
        <div class="detail-ai-note">
          <strong>💡 瑯琊考據提示：</strong>
          <span>${thread.aiDebunkNote}</span>
        </div>
      ` : ""}

      <!-- 評論回帖區 -->
      <section class="replies-section">
        <h3 class="font-serif-tc" style="font-size: 1.15rem; margin-bottom: 1rem; display: flex; align-items: center; gap: 0.4rem;">
          <span>💬</span> 諸君高論 (${allReplies.length})
        </h3>

        <div class="replies-list" id="detailRepliesList">
          ${allReplies.map(r => `
            <div class="reply-item">
              <div class="reply-avatar">${(r.author || "客")[0]}</div>
              <div class="reply-content-box">
                <div class="reply-header">
                  <span class="reply-author">${r.author}</span>
                  <span class="reply-time">${r.time || "剛剛"}</span>
                </div>
                <div class="reply-text">${r.content}</div>
              </div>
            </div>
          `).join("")}
        </div>

        <!-- 發表回覆 -->
        <div class="post-reply-box">
          <div style="font-size: 0.85rem; font-weight: 700; margin-bottom: 0.5rem; color: var(--text-muted);">
            選擇發言身分投帖：
          </div>
          <div class="role-selector-bar">
            ${roles.map(role => `
              <button type="button" class="role-avatar-chip ${State.selectedRoleAvatar === role.id ? "selected" : ""}" 
                      onclick="window.App.selectRole('${role.id}')">
                <span>${role.avatarEmoji}</span>
                <span>${role.name}</span>
              </button>
            `).join("")}
          </div>

          <textarea id="replyTextInput" class="reply-textarea" placeholder="留下您對這段原著細節的獨到見解..."></textarea>
          
          <div style="display: flex; justify-content: flex-end;">
            <button class="btn-post-trigger" onclick="window.App.submitReply('${thread.id}')">
              <span>✍️</span> 提交高見
            </button>
          </div>
        </div>
      </section>
    `;

    modal.classList.add("active");
    document.body.style.overflow = "hidden";
  }

  // 關閉帖子彈窗
  function closeModal() {
    const modals = document.querySelectorAll(".modal-overlay");
    modals.forEach(m => m.classList.remove("active"));
    document.body.style.overflow = "";
    State.activeThreadId = null;
  }

  // 切換角色頭像
  function selectRole(roleId) {
    State.selectedRoleAvatar = roleId;
    SoundFX.playClick();
    document.querySelectorAll(".role-avatar-chip").forEach(chip => {
      chip.classList.remove("selected");
    });
    const selected = document.querySelector(`.role-avatar-chip[onclick*="${roleId}"]`);
    if (selected) selected.classList.add("selected");
  }

  // 提交評論回覆
  function submitReply(threadId) {
    const input = document.getElementById("replyTextInput");
    if (!input || input.value.trim() === "") {
      showToast("請輸入您的高見再行發布", "⚠️");
      return;
    }

    const roles = window.LangyaData.roleAvatars || [];
    const currentRole = roles.find(r => r.id === State.selectedRoleAvatar) || roles[0];

    const newReply = {
      id: "reply-" + Date.now(),
      author: currentRole.name,
      avatar: currentRole.id,
      time: "剛剛・瑯琊即時發帖",
      content: input.value.trim(),
      likes: 1
    };

    if (!State.customReplies[threadId]) {
      State.customReplies[threadId] = [];
    }
    State.customReplies[threadId].push(newReply);
    saveStorage("langya_custom_replies", State.customReplies);

    input.value = "";
    SoundFX.playSuccess();
    showToast("發帖成功！已載入瑯琊研討卷宗", "✨");

    // 重新渲染當前彈窗的評論
    openThreadDetail(threadId);
    renderThreadsList();
  }

  // 點讚切換
  function toggleLike(threadId, e) {
    if (e) e.stopPropagation();
    if (State.likes[threadId]) {
      delete State.likes[threadId];
      showToast("已取消點讚", "🤍");
    } else {
      State.likes[threadId] = true;
      SoundFX.playTone(650, "sine", 0.25, 0.08);
      showToast("靈犀一動！已為該帖增添清譽", "❤️");
    }
    saveStorage("langya_likes", State.likes);
    renderThreadsList();
  }

  // 渲染 原著 vs 電視劇 矩陣對照表
  function renderDramaVsNovel() {
    const container = document.getElementById("diffMatrixGrid");
    if (!container) return;

    const list = window.LangyaData.dramaVsNovelMatrix || [];
    container.innerHTML = list.map((item, idx) => `
      <div class="diff-card">
        <div class="diff-title-row">
          <h3 class="font-serif-tc" style="font-size: 1.2rem; color: var(--text-main);">
            第 ${idx + 1} 案・${item.topic}
          </h3>
          <span class="diff-badge">原著 vs 劇版深度鑑別</span>
        </div>

        <div class="diff-columns">
          <div class="diff-side novel-side">
            <div class="diff-side-title" style="color: var(--accent-jade);">
              <span>📖</span> 海宴《琅琊榜》原著小說
            </div>
            <p style="font-size: 0.92rem; line-height: 1.8; color: var(--text-main);">${item.novel}</p>
          </div>

          <div class="diff-side drama-side">
            <div class="diff-side-title" style="color: var(--accent-red);">
              <span>📺</span> 電視劇經典改編版本
            </div>
            <p style="font-size: 0.92rem; line-height: 1.8; color: var(--text-main);">${item.drama}</p>
          </div>
        </div>

        <div class="diff-significance-box">
          <strong style="color: var(--accent-gold);">📜 文學內涵與深意剖析：</strong>
          <span>${item.significance}</span>
        </div>
      </div>
    `).join("");
  }

  // 渲染 平行時空沙盤推演
  function renderSimulations() {
    const container = document.getElementById("simulationDeck");
    if (!container) return;

    const sims = window.LangyaData.alternateSimulations || [];
    container.innerHTML = sims.map(sim => {
      const curData = State.simSelections[sim.id] || { statePower: 90, ruleOfLaw: 85, monarchTrust: 50, borderSecurity: 90, step: 0 };

      return `
        <div class="sim-card" id="card-${sim.id}">
          <div class="sim-header">
            <h3 class="sim-title font-serif-tc">${sim.title}</h3>
            <div class="sim-tagline">${sim.tagline}</div>
          </div>

          <div class="sim-metrics-bar">
            <div class="metric-item">
              <span class="metric-label">🏛️ 國力昌盛度</span>
              <div class="metric-val-wrap">
                <span class="metric-val" id="metric-power-${sim.id}">${curData.statePower}%</span>
              </div>
            </div>
            <div class="metric-item">
              <span class="metric-label">⚖️ 司法法治度</span>
              <div class="metric-val-wrap">
                <span class="metric-val" id="metric-law-${sim.id}">${curData.ruleOfLaw}%</span>
              </div>
            </div>
            <div class="metric-item">
              <span class="metric-label">👑 君臣信賴值</span>
              <div class="metric-val-wrap">
                <span class="metric-val" id="metric-trust-${sim.id}">${curData.monarchTrust}%</span>
              </div>
            </div>
            <div class="metric-item">
              <span class="metric-label">🛡️ 邊疆安寧度</span>
              <div class="metric-val-wrap">
                <span class="metric-val" id="metric-border-${sim.id}">${curData.borderSecurity}%</span>
              </div>
            </div>
          </div>

          <div class="sim-branch-stepper">
            <h4 class="font-serif-tc" style="font-size: 1.05rem; margin-bottom: 0.5rem; color: var(--ink-secondary);">
              推演決策分支進程：
            </h4>
            ${sim.branches.map((b, bIdx) => `
              <div class="branch-step-card">
                <span class="step-badge">階梯 ${bIdx + 1}：${b.stage}</span>
                <div class="step-choice">決策方針：${b.choiceText}</div>
                <div class="step-result">推演走向：${b.resultText}</div>
              </div>
            `).join("")}
          </div>

          <div class="sim-conclusion-box">
            <strong style="color: var(--accent-gold);">📜 沙盤推演論斷：</strong>
            <span>${sim.conclusion}</span>
          </div>
        </div>
      `;
    }).join("");
  }

  // 渲染 闢謠考據檔案
  function renderFactCheck() {
    const container = document.getElementById("factcheckGrid");
    if (!container) return;

    const list = window.LangyaData.factCheckCases || [];
    container.innerHTML = list.map(item => `
      <div class="factcheck-card">
        <div class="factcheck-header">
          <h3 class="font-serif-tc" style="font-size: 1.15rem; color: var(--text-main);">
            ${item.topic}
          </h3>
          <span class="factcheck-badge">高能闢謠糾偏</span>
        </div>

        <div class="factcheck-comparison">
          <div class="fc-side ai-hallucination">
            <div class="fc-side-label" style="color: var(--accent-red);">
              <span>⚠️</span> AI 典型模型幻覺 / 模糊腦補
            </div>
            <p style="font-size: 0.92rem; line-height: 1.7; color: var(--text-main);">${item.aiHallucination}</p>
          </div>

          <div class="fc-side reader-correction">
            <div class="fc-side-label" style="color: var(--accent-jade);">
              <span>✅</span> 深度原著讀者 截圖考證校準
            </div>
            <p style="font-size: 0.92rem; line-height: 1.7; color: var(--text-main); font-weight: 600;">${item.readerCorrection}</p>
          </div>
        </div>

        <div class="fc-deep-analysis">
          <div style="margin-bottom: 0.4rem;">
            <strong style="color: var(--ink-secondary);">🔎 文本深層剖析：</strong>
            <span>${item.textualAnalysis}</span>
          </div>
          <div>
            <strong style="color: var(--accent-gold);">💡 給文學研究者的啟示：</strong>
            <span>${item.lesson}</span>
          </div>
        </div>
      </div>
    `).join("");
  }

  // 渲染 科舉考典測驗
  function renderQuiz() {
    const container = document.getElementById("quizAppWrapper");
    if (!container) return;

    const questions = window.LangyaData.quizQuestions || [];
    const qState = State.quiz;

    if (qState.finished) {
      const total = questions.length;
      const score = qState.score;
      const pct = Math.round((score / total) * 100);

      let rankTitle = "初入江湖白衣客";
      let rankDesc = "尚需多翻閱幾遍原著，莫被同人影視混淆了名句。";
      if (pct >= 90) {
        rankTitle = "瑯琊閣掌筆祭酒";
        rankDesc = "洞悉全書毫末，字句回目如數家珍，堪稱當代瑯琊閣主！";
      } else if (pct >= 70) {
        rankTitle = "江左盟首席謀士";
        rankDesc = "原著功底極其扎實，對權謀心境與關鍵伏筆皆有高深造詣！";
      } else if (pct >= 50) {
        rankTitle = "南境赤羽校尉";
        rankDesc = "熟知主線大勢，但對細節考據（如雪蚧蟲、輩分稱謂）仍有精進空間。";
      }

      container.innerHTML = `
        <div class="quiz-container-card" style="text-align: center; padding: 3rem 2rem;">
          <div style="font-size: 3.5rem; margin-bottom: 0.8rem;">🏆</div>
          <h2 class="font-serif-tc" style="font-size: 1.8rem; margin-bottom: 0.5rem; color: var(--accent-red);">
            科舉放榜：榮獲【${rankTitle}】
          </h2>
          <p style="font-size: 1rem; color: var(--text-muted); margin-bottom: 1.5rem;">
            您的考核成績為：<strong>${score}</strong> / ${total} 題（準確率 ${pct}%）
          </p>
          <div style="max-width: 500px; margin: 0 auto 2rem; background: var(--bg-secondary); padding: 1.2rem; border-radius: 8px; border: 1px solid var(--border-subtle); line-height: 1.8;">
            ${rankDesc}
          </div>
          <button class="btn-quiz-next" style="margin: 0 auto;" onclick="window.App.restartQuiz()">
            <span>🔄</span> 重新開卷考核
          </button>
        </div>
      `;
      return;
    }

    const curQ = questions[qState.currentIndex];
    const progress = Math.round(((qState.currentIndex + 1) / questions.length) * 100);

    container.innerHTML = `
      <div class="quiz-container-card">
        <div class="quiz-progress-bar-wrap">
          <div class="quiz-progress-bar" style="width: ${progress}%;"></div>
        </div>

        <div class="quiz-header">
          <span style="font-size: 0.85rem; font-weight: 700; color: var(--accent-red);">
            第 ${qState.currentIndex + 1} 題 / 共 ${questions.length} 題
          </span>
          <span style="font-size: 0.85rem; color: var(--text-muted);">
            目前得分：${qState.score}
          </span>
        </div>

        <h3 class="quiz-question-title font-serif-tc">
          ${curQ.question}
        </h3>

        <div class="quiz-options-list">
          ${curQ.options.map((opt, oIdx) => {
            let extraClass = "";
            if (qState.isAnswered) {
              if (oIdx === curQ.correctIndex) extraClass = "correct";
              else if (oIdx === qState.selectedAnswer) extraClass = "wrong";
            }
            return `
              <button class="quiz-option-btn ${extraClass}" onclick="window.App.selectQuizOption(${oIdx})" ${qState.isAnswered ? "disabled" : ""}>
                <span style="font-weight: 700; width: 22px;">${["A", "B", "C", "D"][oIdx]}.</span>
                <span>${opt}</span>
              </button>
            `;
          }).join("")}
        </div>

        <div class="quiz-feedback-box ${qState.isAnswered ? "active" : ""}">
          <strong style="color: ${qState.selectedAnswer === curQ.correctIndex ? "var(--accent-jade)" : "var(--accent-red)};">
            ${qState.selectedAnswer === curQ.correctIndex ? "🎉 恭喜答對！" : "❌ 遺憾答錯！"}
          </strong>
          <div style="font-size: 0.92rem; margin-top: 0.4rem; color: var(--text-main);">
            ${curQ.explanation}
          </div>
        </div>

        <div class="quiz-nav-row">
          <div style="font-size: 0.82rem; color: var(--text-light);">
            考核考點皆依據 55 頁全本原著研讀紀錄嚴格校準
          </div>
          ${qState.isAnswered ? `
            <button class="btn-quiz-next" onclick="window.App.nextQuizQuestion()">
              <span>${qState.currentIndex + 1 >= questions.length ? "查看總榜 →" : "下一題 →"}</span>
            </button>
          ` : ""}
        </div>
      </div>
    `;
  }

  // 作答考題
  function selectQuizOption(index) {
    if (State.quiz.isAnswered) return;
    const questions = window.LangyaData.quizQuestions || [];
    const curQ = questions[State.quiz.currentIndex];

    State.quiz.selectedAnswer = index;
    State.quiz.isAnswered = true;

    if (index === curQ.correctIndex) {
      State.quiz.score += 1;
      SoundFX.playSuccess();
      showToast("命中正鵠！得一分", "🎯");
    } else {
      SoundFX.playTone(280, "sawtooth", 0.3, 0.08);
      showToast("選有偏失，請詳讀卷宗解說", "⚠️");
    }

    renderQuiz();
  }

  // 下一題
  function nextQuizQuestion() {
    const questions = window.LangyaData.quizQuestions || [];
    if (State.quiz.currentIndex + 1 >= questions.length) {
      State.quiz.finished = true;
      SoundFX.playChime();
    } else {
      State.quiz.currentIndex += 1;
      State.quiz.selectedAnswer = null;
      State.quiz.isAnswered = false;
      SoundFX.playClick();
    }
    renderQuiz();
  }

  function restartQuiz() {
    State.quiz = {
      currentIndex: 0,
      selectedAnswer: null,
      isAnswered: false,
      score: 0,
      userAnswers: [],
      finished: false
    };
    SoundFX.playClick();
    renderQuiz();
  }

  // 渲染 天下清議民調
  function renderPolls() {
    const container = document.getElementById("pollsGrid");
    if (!container) return;

    const polls = window.LangyaData.communityPolls || [];
    container.innerHTML = polls.map(poll => {
      const userVote = State.pollVotes[poll.id];
      const hasVoted = !!userVote;

      // 計算總票數（包含使用者投的一票）
      let total = poll.totalVotes;
      if (hasVoted) total += 1;

      return `
        <div class="poll-card">
          <div>
            <h3 class="poll-question font-serif-tc">${poll.title}</h3>
            <p class="poll-desc">${poll.desc}</p>

            <div class="poll-options-wrapper">
              ${poll.options.map(opt => {
                let votes = opt.votes;
                if (userVote === opt.id) votes += 1;
                const pct = total > 0 ? Math.round((votes / total) * 100) : 0;
                const isSelected = userVote === opt.id;

                return `
                  <div class="poll-option-row ${isSelected ? "voted" : ""}" 
                       onclick="window.App.votePoll('${poll.id}', '${opt.id}')">
                    <div class="poll-bar-fill" style="width: ${hasVoted ? pct : 0}%;"></div>
                    <span class="poll-opt-text">
                      ${isSelected ? "✔️ " : ""}${opt.text}
                    </span>
                    ${hasVoted ? `<span class="poll-opt-pct">${pct}%</span>` : ""}
                  </div>
                `;
              }).join("")}
            </div>
          </div>

          <div style="display: flex; justify-content: space-between; align-items: center; font-size: 0.78rem; color: var(--text-light); padding-top: 0.75rem; border-top: 1px solid var(--border-subtle);">
            <span>🗳️ 累計參議客：${total} 人</span>
            <span>${hasVoted ? "已投帖表態" : "點選選項即可即時投票"}</span>
          </div>
        </div>
      `;
    }).join("");
  }

  // 民調投票
  function votePoll(pollId, optionId) {
    if (State.pollVotes[pollId]) {
      showToast("您已在此議題中表態投帖", "🗳️");
      return;
    }
    State.pollVotes[pollId] = optionId;
    saveStorage("langya_poll_votes", State.pollVotes);
    SoundFX.playSuccess();
    showToast("投票成功！天下清議已記錄您的觀點", "🎉");
    renderPolls();
  }

  // 渲染 金句墨寶
  function renderQuotes() {
    const container = document.getElementById("quotesMasonry");
    if (!container) return;

    const list = window.LangyaData.goldenQuotes || [];
    container.innerHTML = list.map((q, idx) => `
      <div class="quote-scroll-card">
        <div class="quote-text-body font-serif-tc">
          ${q.quote}
        </div>
        <div class="quote-source-row">
          <div>
            <strong>${q.author}</strong>
            <span style="display: block; font-size: 0.72rem; color: var(--text-light);">${q.source}</span>
          </div>
          <button class="tool-icon-btn" style="width: 30px; height: 30px; font-size: 0.8rem;" 
                  onclick="window.App.copyQuote('${idx}')" title="複製墨寶">
            📋
          </button>
        </div>
      </div>
    `).join("");
  }

  // 複製金句
  function copyQuote(index) {
    const list = window.LangyaData.goldenQuotes || [];
    const item = list[index];
    if (!item) return;

    const textToCopy = `「${item.quote}」—— 出自《琅琊榜》原著思辨（${item.source}）`;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(textToCopy).then(() => {
        showToast("金句已複製至剪貼簿", "📋");
      }).catch(() => {
        showToast("複製已完成", "📋");
      });
    } else {
      showToast("金句已摘錄", "📋");
    }
  }

  // 發起新討論帖 (Modal)
  function openCreateThreadModal() {
    const modal = document.getElementById("createThreadModal");
    if (!modal) return;
    SoundFX.playChime();
    modal.classList.add("active");
    document.body.style.overflow = "hidden";
  }

  function submitNewThread(e) {
    if (e) e.preventDefault();
    const titleInput = document.getElementById("newThreadTitle");
    const catInput = document.getElementById("newThreadCategory");
    const summaryInput = document.getElementById("newThreadSummary");
    const quoteInput = document.getElementById("newThreadQuote");
    const tagsInput = document.getElementById("newThreadTags");

    if (!titleInput || titleInput.value.trim() === "") {
      showToast("請輸入帖子標題", "⚠️");
      return;
    }
    if (!summaryInput || summaryInput.value.trim() === "") {
      showToast("請輸入主要研討闡述", "⚠️");
      return;
    }

    const roles = window.LangyaData.roleAvatars || [];
    const currentRole = roles.find(r => r.id === State.selectedRoleAvatar) || roles[0];

    const tagsArray = (tagsInput.value || "")
      .split(/[,，\s]+/)
      .filter(t => t.trim() !== "");

    const newThread = {
      id: "custom-" + Date.now(),
      categoryId: catInput ? catInput.value : "affection",
      title: titleInput.value.trim(),
      author: currentRole.name,
      avatar: currentRole.id,
      authorRole: currentRole.title,
      publishChapter: "讀者原著思辨新篇",
      views: 1,
      likes: 1,
      badge: "墨客原創",
      tags: tagsArray.length > 0 ? tagsArray : ["讀者思辨", "原著研討"],
      summary: summaryInput.value.trim(),
      pdfOrigin: "讀者原創研讀",
      quote: quoteInput ? quoteInput.value.trim() : "",
      keyPoints: [
        {
          heading: "一、論點核心旨意",
          content: summaryInput.value.trim()
        }
      ],
      aiDebunkNote: "本帖由讀者新近發起，等待瑯琊墨客跟帖論戰。",
      replies: []
    };

    State.customThreads.unshift(newThread);
    saveStorage("langya_custom_threads", State.customThreads);

    // 清空表單
    titleInput.value = "";
    summaryInput.value = "";
    if (quoteInput) quoteInput.value = "";
    if (tagsInput) tagsInput.value = "";

    closeModal();
    SoundFX.playSuccess();
    showToast("新帖發布成功！已列入瑯琊卷宗", "🎉");

    // 切換回首頁論壇並渲染
    switchTab("threads");
    renderThreadsList();
  }

  // 標籤頁切換
  function switchTab(tabId) {
    State.activeTab = tabId;
    SoundFX.playClick();

    // 更新導航列按鈕高亮
    document.querySelectorAll(".nav-btn").forEach(btn => {
      if (btn.getAttribute("data-target") === tabId) {
        btn.classList.add("active");
      } else {
        btn.classList.remove("active");
      }
    });

    // 切換區域顯示
    document.querySelectorAll(".view-section").forEach(sec => {
      if (sec.id === `section-${tabId}`) {
        sec.classList.add("active");
      } else {
        sec.classList.remove("active");
      }
    });

    window.scrollTo({ top: 0, behavior: "smooth" });

    // 依標籤載入相應模組
    if (tabId === "threads") renderThreadsList();
    else if (tabId === "matrix") renderDramaVsNovel();
    else if (tabId === "sandtable") renderSimulations();
    else if (tabId === "debunk") renderFactCheck();
    else if (tabId === "quiz") renderQuiz();
    else if (tabId === "polls") renderPolls();
    else if (tabId === "quotes") renderQuotes();
  }

  // 字體調整
  function changeFontSize(delta) {
    State.fontSize = Math.max(14, Math.min(22, State.fontSize + delta));
    document.documentElement.style.fontSize = State.fontSize + "px";
    saveStorage("langya_font_size", State.fontSize);
    showToast(`字體已調為 ${State.fontSize}px`, "🔍");
  }

  // 深色明亮主題切換
  function toggleTheme() {
    State.darkMode = !State.darkMode;
    if (State.darkMode) {
      document.body.classList.add("dark-mode");
      showToast("已換為【青霜墨岩】夜間研讀模式", "🌙");
    } else {
      document.body.classList.remove("dark-mode");
      showToast("已換為【宣紙墨黛】經典明亮模式", "☀️");
    }
    saveStorage("langya_dark_mode", State.darkMode);
    SoundFX.playTone(500, "sine", 0.15, 0.05);
  }

  // 音效開關切換
  function toggleSound() {
    State.soundEnabled = !State.soundEnabled;
    const btn = document.getElementById("soundToggleBtn");
    if (btn) {
      btn.textContent = State.soundEnabled ? "🔔" : "🔕";
      btn.title = State.soundEnabled ? "音效開啟" : "音效已靜音";
    }
    showToast(State.soundEnabled ? "瑯琊金石音效已開啟" : "音效已靜音", State.soundEnabled ? "🔔" : "🔕");
  }

  // 初始化 DOM 事件
  function initEvents() {
    // 導航標籤點擊
    document.querySelectorAll(".nav-btn").forEach(btn => {
      btn.addEventListener("click", function () {
        const target = this.getAttribute("data-target");
        if (target) switchTab(target);
      });
    });

    // 搜尋輸入監聽
    const searchInput = document.getElementById("forumSearchInput");
    if (searchInput) {
      searchInput.addEventListener("input", function () {
        State.searchKeyword = this.value;
        renderThreadsList();
      });
    }

    // 字體按鈕
    const fontDec = document.getElementById("fontDecreaseBtn");
    const fontInc = document.getElementById("fontIncreaseBtn");
    if (fontDec) fontDec.addEventListener("click", () => changeFontSize(-1));
    if (fontInc) fontInc.addEventListener("click", () => changeFontSize(1));

    // 主題按鈕
    const themeBtn = document.getElementById("themeToggleBtn");
    if (themeBtn) themeBtn.addEventListener("click", toggleTheme);

    // 音效按鈕
    const soundBtn = document.getElementById("soundToggleBtn");
    if (soundBtn) soundBtn.addEventListener("click", toggleSound);

    // 彈窗背景點擊關閉
    document.querySelectorAll(".modal-overlay").forEach(m => {
      m.addEventListener("click", function (e) {
        if (e.target === this) closeModal();
      });
    });

    // 鍵盤 ESC 關閉彈窗
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") closeModal();
    });
  }

  // 應用啟動入口
  function initApp() {
    loadStorage();

    // 恢復主題與字型
    if (State.darkMode) document.body.classList.add("dark-mode");
    if (State.fontSize) document.documentElement.style.fontSize = State.fontSize + "px";

    initEvents();
    renderCategoryTags();
    renderThreadsList();

    // 預先載入第一筆沙盤推演與考點
    renderDramaVsNovel();
    renderSimulations();
    renderFactCheck();
    renderQuiz();
    renderPolls();
    renderQuotes();
  }

  // 公開至全域物件 window.App
  window.App = {
    init: initApp,
    switchTab: switchTab,
    openThreadDetail: openThreadDetail,
    closeModal: closeModal,
    toggleLike: toggleLike,
    selectRole: selectRole,
    submitReply: submitReply,
    votePoll: votePoll,
    selectQuizOption: selectQuizOption,
    nextQuizQuestion: nextQuizQuestion,
    restartQuiz: restartQuiz,
    copyQuote: copyQuote,
    openCreateThreadModal: openCreateThreadModal,
    submitNewThread: submitNewThread,
    toggleTheme: toggleTheme,
    toggleSound: toggleSound
  };

  // 當 DOM 加載完畢時初始化
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initApp);
  } else {
    initApp();
  }
})();
