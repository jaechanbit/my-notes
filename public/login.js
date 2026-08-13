const form = document.querySelector('#login-form');
const loginButton = document.querySelector('#login-button');
const errorMessage = document.querySelector('#login-error');

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  loginButton.disabled = true;
  errorMessage.hidden = true;

  try {
    const response = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: form.username.value.trim(),
        password: form.password.value,
      }),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.message || '로그인하지 못했습니다.');
    window.location.replace('/');
  } catch (error) {
    errorMessage.textContent = error.message;
    errorMessage.hidden = false;
  } finally {
    loginButton.disabled = false;
  }
});
