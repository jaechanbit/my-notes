const searchInput = document.querySelector('#search');
const noteList = document.querySelector('#note-list');
const noteCount = document.querySelector('#note-count');
const emptyMessage = document.querySelector('#empty-message');
const message = document.querySelector('#message');
const dialog = document.querySelector('#note-dialog');
const form = document.querySelector('#note-form');
const noteIdInput = document.querySelector('#note-id');
const titleInput = document.querySelector('#title');
const contentInput = document.querySelector('#content');
const dialogTitle = document.querySelector('#dialog-title');
const formError = document.querySelector('#form-error');
const deleteButton = document.querySelector('#delete-button');
const saveButton = document.querySelector('#save-button');

let notes = [];

function showMessage(text, type = 'error') {
  message.textContent = text;
  message.className = `message ${type}`;
  message.hidden = false;
  window.clearTimeout(showMessage.timeout);
  showMessage.timeout = window.setTimeout(() => { message.hidden = true; }, 5000);
}

function formatDate(value) {
  if (!value) return '날짜 없음';
  return new Intl.DateTimeFormat('ko-KR', { year: 'numeric', month: 'long', day: 'numeric' })
    .format(new Date(value));
}

function renderNotes() {
  const keyword = searchInput.value.trim().toLocaleLowerCase('ko');
  const visibleNotes = notes.filter(({ title, content }) =>
    `${title} ${content}`.toLocaleLowerCase('ko').includes(keyword));

  noteList.replaceChildren(...visibleNotes.map((note) => {
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'note-card';
    card.dataset.id = note.id;

    const date = document.createElement('span');
    date.className = 'note-meta';
    date.textContent = formatDate(note.updated_at || note.created_at);
    const title = document.createElement('h3');
    title.textContent = note.title;
    const content = document.createElement('p');
    content.textContent = note.content;
    card.append(date, title, content);
    card.addEventListener('click', () => openExistingNote(note));
    return card;
  }));

  noteCount.textContent = `${visibleNotes.length}개의 메모`;
  emptyMessage.textContent = keyword ? '검색 결과가 없습니다.' : '아직 작성한 메모가 없습니다.';
  emptyMessage.hidden = visibleNotes.length !== 0;
}

function showDialog() {
  if (typeof dialog.showModal === 'function') {
    if (!dialog.open) dialog.showModal();
  } else {
    dialog.setAttribute('open', '');
  }
}

function closeDialog() {
  if (typeof dialog.close === 'function') dialog.close();
  else dialog.removeAttribute('open');
}

async function request(url, options) {
  const response = await fetch(url, options);
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.message || '요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.');
  }
  return response.status === 204 ? null : response.json();
}

async function loadNotes() {
  try {
    notes = await request('/api/notes');
    renderNotes();
  } catch (error) {
    emptyMessage.textContent = '메모를 불러오지 못했습니다.';
    showMessage(error.message);
  }
}

function openNewNote() {
  form.reset();
  noteIdInput.value = '';
  dialogTitle.textContent = '새 메모 작성';
  deleteButton.hidden = true;
  formError.hidden = true;
  showDialog();
  titleInput.focus();
}

function openExistingNote(note) {
  noteIdInput.value = note.id;
  titleInput.value = note.title;
  contentInput.value = note.content;
  dialogTitle.textContent = '메모 수정';
  deleteButton.hidden = false;
  formError.hidden = true;
  showDialog();
  titleInput.focus();
}

document.querySelector('#new-note-button').addEventListener('click', openNewNote);
document.querySelector('#close-dialog').addEventListener('click', closeDialog);
document.querySelector('#cancel-button').addEventListener('click', closeDialog);
searchInput.addEventListener('input', renderNotes);

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const title = titleInput.value.trim();
  const content = contentInput.value.trim();
  if (!title || !content) {
    formError.textContent = '제목과 내용을 모두 입력해 주세요.';
    formError.hidden = false;
    return;
  }

  const id = noteIdInput.value;
  saveButton.disabled = true;
  formError.hidden = true;
  try {
    await request(id ? `/api/notes/${id}` : '/api/notes', {
      method: id ? 'PUT' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, content }),
    });
    closeDialog();
    await loadNotes();
    showMessage(id ? '메모를 수정했습니다.' : '메모를 저장했습니다.', 'success');
  } catch (error) {
    formError.textContent = error.message;
    formError.hidden = false;
  } finally {
    saveButton.disabled = false;
  }
});

deleteButton.addEventListener('click', async () => {
  const id = noteIdInput.value;
  if (!id || !window.confirm('이 메모를 삭제할까요?')) return;
  deleteButton.disabled = true;
  try {
    await request(`/api/notes/${id}`, { method: 'DELETE' });
    closeDialog();
    await loadNotes();
    showMessage('메모를 삭제했습니다.', 'success');
  } catch (error) {
    formError.textContent = error.message;
    formError.hidden = false;
  } finally {
    deleteButton.disabled = false;
  }
});

loadNotes();
