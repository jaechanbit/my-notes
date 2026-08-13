const searchInput = document.querySelector('#search');
const sortSelect = document.querySelector('#sort');
const noteList = document.querySelector('#note-list');
const noteCount = document.querySelector('#note-count');
const emptyMessage = document.querySelector('#empty-message');
const message = document.querySelector('#message');
const dialog = document.querySelector('#note-dialog');
const form = document.querySelector('#note-form');
const noteIdInput = document.querySelector('#note-id');
const titleInput = document.querySelector('#title');
const contentInput = document.querySelector('#content');
const tagsInput = document.querySelector('#tags');
const tagFilterList = document.querySelector('#tag-filter-list');
const dialogTitle = document.querySelector('#dialog-title');
const formError = document.querySelector('#form-error');
const deleteButton = document.querySelector('#delete-button');
const saveButton = document.querySelector('#save-button');
const currentUser = document.querySelector('#current-user');

let notes = [];
let selectedTag = '';
const SORT_STORAGE_KEY = 'my-notes-sort';
const SORT_OPTIONS = new Set(['newest', 'oldest', 'favorite', 'title-asc', 'title-desc']);

function loadSavedSort() {
  try {
    const savedSort = window.localStorage.getItem(SORT_STORAGE_KEY);
    return SORT_OPTIONS.has(savedSort) ? savedSort : 'newest';
  } catch {
    return 'newest';
  }
}

sortSelect.value = loadSavedSort();

function parseTags(value) {
  const tags = [];
  value.split(',').forEach((part) => {
    const tag = part.trim();
    if (tag && !tags.some((item) => item.toLocaleLowerCase('ko') === tag.toLocaleLowerCase('ko'))) {
      tags.push(tag);
    }
  });
  return tags;
}

function renderTagFilters() {
  const allTags = [];
  notes.forEach((note) => (note.tags || []).forEach((tag) => {
    if (!allTags.some((item) => item.toLocaleLowerCase('ko') === tag.toLocaleLowerCase('ko'))) {
      allTags.push(tag);
    }
  }));
  allTags.sort((a, b) => a.localeCompare(b, 'ko'));

  const makeButton = (label, value) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `tag-filter-button${selectedTag === value ? ' active' : ''}`;
    button.textContent = label;
    button.setAttribute('aria-pressed', selectedTag === value);
    button.addEventListener('click', () => {
      selectedTag = value;
      renderNotes();
    });
    return button;
  };
  tagFilterList.replaceChildren(makeButton('전체', ''), ...allTags.map((tag) => makeButton(tag, tag)));
}

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

function noteTime(note) {
  const time = Date.parse(note.updated_at || note.created_at || '');
  return Number.isNaN(time) ? 0 : time;
}

function compareNotes(a, b) {
  const newestFirst = () => noteTime(b) - noteTime(a) || Number(b.id) - Number(a.id);

  switch (sortSelect.value) {
    case 'oldest':
      return noteTime(a) - noteTime(b) || Number(a.id) - Number(b.id);
    case 'favorite':
      return Number(b.favorite) - Number(a.favorite) || newestFirst();
    case 'title-asc':
      return a.title.localeCompare(b.title, 'ko', { sensitivity: 'base', numeric: true })
        || Number(a.id) - Number(b.id);
    case 'title-desc':
      return b.title.localeCompare(a.title, 'ko', { sensitivity: 'base', numeric: true })
        || Number(b.id) - Number(a.id);
    default:
      return newestFirst();
  }
}

function renderNotes() {
  const keyword = searchInput.value.trim().toLocaleLowerCase('ko');
  const visibleNotes = notes
    .filter(({ title, content, tags = [] }) => `${title} ${content} ${tags.join(' ')}`.toLocaleLowerCase('ko').includes(keyword))
    .filter(({ tags = [] }) => !selectedTag || tags.some((tag) => tag.toLocaleLowerCase('ko') === selectedTag.toLocaleLowerCase('ko')))
    .sort(compareNotes);

  noteList.replaceChildren(...visibleNotes.map((note) => {
    const card = document.createElement('article');
    card.className = 'note-card';
    card.dataset.id = note.id;

    const openButton = document.createElement('button');
    openButton.type = 'button';
    openButton.className = 'note-open-button';
    openButton.setAttribute('aria-label', `${note.title} 메모 열기`);

    const date = document.createElement('span');
    date.className = 'note-meta';
    date.textContent = formatDate(note.updated_at || note.created_at);
    const title = document.createElement('h3');
    title.textContent = note.title;
    const content = document.createElement('p');
    content.textContent = note.content;
    const tagList = document.createElement('div');
    tagList.className = 'note-tags';
    (note.tags || []).forEach((tag) => {
      const tagButton = document.createElement('button');
      tagButton.type = 'button';
      tagButton.className = 'tag-badge';
      tagButton.textContent = tag;
      tagButton.setAttribute('aria-label', `${tag} 태그로 필터링`);
      tagButton.addEventListener('click', (event) => {
        event.stopPropagation();
        selectedTag = tag;
        renderNotes();
      });
      tagList.append(tagButton);
    });
    openButton.append(date, title, content);
    openButton.addEventListener('click', () => openExistingNote(note));

    const favoriteButton = document.createElement('button');
    favoriteButton.type = 'button';
    favoriteButton.className = 'favorite-button';
    favoriteButton.textContent = note.favorite ? '★' : '☆';
    favoriteButton.setAttribute('aria-label', note.favorite ? '즐겨찾기 해제' : '즐겨찾기 추가');
    favoriteButton.setAttribute('aria-pressed', Boolean(note.favorite));
    favoriteButton.addEventListener('click', () => toggleFavorite(note));

    card.append(openButton, tagList, favoriteButton);
    return card;
  }));

  renderTagFilters();
  noteCount.textContent = `${visibleNotes.length}개의 메모`;
  emptyMessage.textContent = keyword || selectedTag ? '조건에 맞는 메모가 없습니다.' : '아직 작성한 메모가 없습니다.';
  emptyMessage.hidden = visibleNotes.length !== 0;
}

async function toggleFavorite(note) {
  const previousFavorite = Number(note.favorite);
  note.favorite = previousFavorite ? 0 : 1;
  renderNotes();

  try {
    const updated = await request(`/api/notes/${note.id}/favorite`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ favorite: Boolean(note.favorite) }),
    });
    Object.assign(note, updated);
  } catch (error) {
    note.favorite = previousFavorite;
    renderNotes();
    showMessage(error.message);
  }
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
  if (response.status === 401) {
    window.location.replace('/login');
    throw new Error('로그인이 필요합니다.');
  }
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.message || '요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.');
  }
  return response.status === 204 ? null : response.json();
}

async function loadSession() {
  const session = await request('/api/auth/session');
  currentUser.textContent = session.username;
}

async function loadNotes() {
  try {
    notes = await request(`/api/notes?sort=${encodeURIComponent(sortSelect.value)}`);
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
  tagsInput.value = (note.tags || []).join(', ');
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
sortSelect.addEventListener('change', () => {
  try {
    window.localStorage.setItem(SORT_STORAGE_KEY, sortSelect.value);
  } catch {
    // 저장소를 사용할 수 없어도 현재 페이지의 정렬은 유지한다.
  }
  renderNotes();
});

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const title = titleInput.value.trim();
  const content = contentInput.value.trim();
  const tags = parseTags(tagsInput.value);
  if (!title || !content) {
    formError.textContent = '제목과 내용을 모두 입력해 주세요.';
    formError.hidden = false;
    return;
  }
  if (tags.length > 20 || tags.some((tag) => tag.length > 30)) {
    formError.textContent = '태그는 각각 30자 이하, 최대 20개까지 입력해 주세요.';
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
      body: JSON.stringify({ title, content, tags }),
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

document.querySelector('#logout-button').addEventListener('click', async () => {
  try {
    await request('/api/auth/logout', { method: 'POST' });
    window.location.replace('/login');
  } catch (error) {
    showMessage(error.message);
  }
});

Promise.all([loadSession(), loadNotes()]).catch((error) => showMessage(error.message));
