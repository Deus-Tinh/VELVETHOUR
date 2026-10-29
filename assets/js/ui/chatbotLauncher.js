let loadWindowModule;

export function initChatbot() {
  if (document.getElementById('serenityChatLauncher')) return;
  const launcher = document.createElement('button');
  launcher.type = 'button';
  launcher.id = 'serenityChatLauncher';
  launcher.className = 'serenity-chat-launcher';
  launcher.setAttribute('aria-label', 'Mở Trợ lý Serenity Spa');
  launcher.setAttribute('aria-haspopup', 'dialog');
  launcher.setAttribute('aria-expanded', 'false');
  launcher.title = 'Trợ lý Serenity Spa';
  launcher.innerHTML = '<span class="serenity-chat-launcher-face" aria-hidden="true">✿</span><span class="serenity-chat-launcher-label">Tư vấn</span>';
  launcher.addEventListener('click', async () => {
    launcher.disabled = true;
    try {
      loadWindowModule ||= import('./chatbotWindow.js');
      const chat = await loadWindowModule;
      await chat.toggleChatbot();
    } catch {
      launcher.setAttribute('aria-label', 'Không thể mở trợ lý. Vui lòng tải lại trang.');
    } finally {
      launcher.disabled = false;
    }
  });
  document.body.append(launcher);
}
