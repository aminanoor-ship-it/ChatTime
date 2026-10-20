import {
  createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef,
} from 'react';
import { api, errorMessage } from '../../lib/api';
import { socket, request } from '../../lib/socket';
import { previewFor, uuid } from '../../lib/format';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../components/Toast';

const ChatContext = createContext(null);

const initialState = {
  conversations: {},
  conversationsLoaded: false,
  messages: {},
  pinned: {},
  online: {},
  typing: {},
  notifications: { items: [], unread: 0, loaded: false },
  settings: { max_upload_mb: 15, allowed_file_categories: ['image', 'document', 'audio', 'video'], message_edit_window_minutes: 15, max_group_members: 100 },
  connected: false,
};

const emptyThread = { items: [], hasMore: true, loaded: false };

function upsertMessage(items, message) {
  const index = items.findIndex((item) => item.id === message.id
    || (message.client_message_id && item.client_message_id === message.client_message_id));
  if (index === -1) {
    const next = [...items, message];
    // Keep server order; unsent (pending or failed) messages have temporary ids and stay at the end.
    const order = (item) => (typeof item.id === 'number' ? item.id : Number.MAX_SAFE_INTEGER);
    return next.sort((a, b) => order(a) - order(b));
  }
  const next = [...items];
  next[index] = { ...items[index], ...message, pending: message.pending || false, failed: message.failed || false };
  return next;
}

function reducer(state, action) {
  switch (action.type) {
    case 'connected':
      return { ...state, connected: action.value };
    case 'settings':
      return { ...state, settings: { ...state.settings, ...action.settings } };
    case 'conversations/set': {
      const conversations = {};
      for (const conversation of action.list) conversations[conversation.id] = conversation;
      return { ...state, conversations, conversationsLoaded: true };
    }
    case 'conversation/upsert':
      return { ...state, conversations: { ...state.conversations, [action.conversation.id]: action.conversation } };
    case 'conversation/patch': {
      const current = state.conversations[action.id];
      if (!current) return state;
      return { ...state, conversations: { ...state.conversations, [action.id]: { ...current, ...action.patch } } };
    }
    case 'conversation/remove': {
      const { [action.id]: _removed, ...rest } = state.conversations;
      return { ...state, conversations: rest };
    }
    case 'thread/loaded': {
      const current = state.messages[action.id] || emptyThread;
      let items;
      if (action.mode === 'prepend') items = [...action.items, ...current.items];
      else if (action.mode === 'append') items = action.items.reduce(upsertMessage, current.items);
      else items = [...action.items, ...current.items.filter((item) => item.pending || item.failed)];
      return {
        ...state,
        messages: {
          ...state.messages,
          [action.id]: { items, hasMore: action.mode === 'append' ? current.hasMore : action.hasMore, loaded: true },
        },
      };
    }
    case 'message/upsert': {
      const { message } = action;
      const thread = state.messages[message.conversation_id];
      const messages = thread
        ? { ...state.messages, [message.conversation_id]: { ...thread, items: upsertMessage(thread.items, message) } }
        : state.messages;
      let { conversations } = state;
      const conversation = conversations[message.conversation_id];
      if (action.isNew && conversation && !message.pending) {
        conversations = {
          ...conversations,
          [conversation.id]: {
            ...conversation,
            last_message_at: message.created_at,
            last_message_preview: message.message_type === 'system' ? message.body : previewFor(message),
            last_message: { id: message.id, sender_id: message.sender.id, sender_name: message.sender.display_name, message_type: message.message_type, status: message.status },
            unread_count: conversation.unread_count + (action.countUnread ? 1 : 0),
            is_archived: action.countUnread && !conversation.is_muted ? false : conversation.is_archived,
          },
        };
      }
      return { ...state, messages, conversations };
    }
    case 'message/failed': {
      const thread = state.messages[action.conversationId];
      if (!thread) return state;
      return {
        ...state,
        messages: {
          ...state.messages,
          [action.conversationId]: {
            ...thread,
            items: thread.items.map((item) => (item.client_message_id === action.clientId ? { ...item, pending: false, failed: true, error: action.error } : item)),
          },
        },
      };
    }
    case 'message/discard': {
      const thread = state.messages[action.conversationId];
      if (!thread) return state;
      return {
        ...state,
        messages: { ...state.messages, [action.conversationId]: { ...thread, items: thread.items.filter((item) => item.client_message_id !== action.clientId) } },
      };
    }
    case 'message/patch': {
      const thread = state.messages[action.conversationId];
      if (!thread) return state;
      return {
        ...state,
        messages: {
          ...state.messages,
          [action.conversationId]: { ...thread, items: thread.items.map((item) => (item.id === action.id ? { ...item, ...action.patch } : item)) },
        },
      };
    }
    case 'message/statuses': {
      const thread = state.messages[action.conversationId];
      const byId = new Map(action.statuses.map((entry) => [entry.id, entry.status]));
      const conversation = state.conversations[action.conversationId];
      const conversations = conversation?.last_message && byId.has(conversation.last_message.id)
        ? { ...state.conversations, [conversation.id]: { ...conversation, last_message: { ...conversation.last_message, status: byId.get(conversation.last_message.id) } } }
        : state.conversations;
      if (!thread) return { ...state, conversations };
      return {
        ...state,
        conversations,
        messages: {
          ...state.messages,
          [action.conversationId]: { ...thread, items: thread.items.map((item) => (byId.has(item.id) ? { ...item, status: byId.get(item.id) } : item)) },
        },
      };
    }
    case 'pinned':
      return { ...state, pinned: { ...state.pinned, [action.conversationId]: action.message } };
    case 'presence/set':
      return { ...state, online: Object.fromEntries(action.ids.map((id) => [id, true])) };
    case 'presence/update': {
      const online = { ...state.online };
      if (action.online) online[action.userId] = true;
      else delete online[action.userId];
      let { conversations } = state;
      if (!action.online && action.lastSeen) {
        conversations = Object.fromEntries(Object.entries(conversations).map(([id, conversation]) => [
          id,
          conversation.other_user?.id === action.userId
            ? { ...conversation, other_user: { ...conversation.other_user, last_seen_at: action.lastSeen } }
            : conversation,
        ]));
      }
      return { ...state, online, conversations };
    }
    case 'typing': {
      const current = { ...(state.typing[action.conversationId] || {}) };
      if (action.typing) current[action.userId] = action.name;
      else delete current[action.userId];
      return { ...state, typing: { ...state.typing, [action.conversationId]: current } };
    }
    case 'notifications/set':
      return { ...state, notifications: { items: action.items, unread: action.unread, loaded: true } };
    case 'notifications/add':
      return {
        ...state,
        notifications: {
          ...state.notifications,
          items: [action.notification, ...state.notifications.items.filter((item) => item.id !== action.notification.id)],
          unread: state.notifications.unread + 1,
        },
      };
    case 'notifications/read': {
      const now = new Date().toISOString();
      const items = state.notifications.items.map((item) => (action.all || item.id === action.id ? { ...item, read_at: item.read_at || now } : item));
      return { ...state, notifications: { ...state.notifications, items, unread: items.filter((item) => !item.read_at).length } };
    }
    case 'user/updated': {
      const conversations = Object.fromEntries(Object.entries(state.conversations).map(([id, conversation]) => {
        if (conversation.other_user?.id !== action.user.id) return [id, conversation];
        return [id, {
          ...conversation,
          title: action.user.display_name,
          avatar_url: action.user.avatar_url,
          other_user: { ...conversation.other_user, ...action.user },
        }];
      }));
      return { ...state, conversations };
    }
    default:
      return state;
  }
}

function playPing() {
  try {
    const context = new (window.AudioContext || window.webkitAudioContext)();
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(880, context.currentTime);
    oscillator.frequency.exponentialRampToValueAtTime(1320, context.currentTime + 0.08);
    gain.gain.setValueAtTime(0.0001, context.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.12, context.currentTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.25);
    oscillator.connect(gain).connect(context.destination);
    oscillator.start();
    oscillator.stop(context.currentTime + 0.3);
    oscillator.onended = () => context.close();
  } catch (_error) { /* sound is optional */ }
}

export function ChatProvider({ children }) {
  const { user, logout, refresh: refreshUser } = useAuth();
  const toast = useToast();
  const [state, dispatch] = useReducer(reducer, initialState);
  const stateRef = useRef(state);
  stateRef.current = state;
  const activeRef = useRef(null);
  const prefsRef = useRef({ desktop_enabled: true, sound_enabled: true });
  const typingTimers = useRef({});
  const hasConnected = useRef(false);

  const loadConversations = useCallback(async () => {
    const { data } = await api.get('/conversations');
    dispatch({ type: 'conversations/set', list: data.conversations });
    return data.conversations;
  }, []);

  const refreshConversation = useCallback(async (id) => {
    try {
      const { data } = await api.get(`/conversations/${id}`);
      const { pinned_message: pinned, ...conversation } = data.conversation;
      dispatch({ type: 'conversation/upsert', conversation });
      dispatch({ type: 'pinned', conversationId: id, message: pinned });
      return conversation;
    } catch (error) {
      if ([403, 404].includes(error.response?.status)) dispatch({ type: 'conversation/remove', id });
      return null;
    }
  }, []);

  const loadNotifications = useCallback(async () => {
    const { data } = await api.get('/notifications');
    dispatch({ type: 'notifications/set', items: data.notifications, unread: data.unread_count });
  }, []);

  const markRead = useCallback((conversationId) => {
    const conversation = stateRef.current.conversations[conversationId];
    if (!conversation) return;
    dispatch({ type: 'conversation/patch', id: conversationId, patch: { unread_count: 0 } });
    if (conversation.unread_count > 0 || stateRef.current.messages[conversationId]?.items.some((m) => m.sender.id !== user.id && m.status !== 'read')) {
      socket.emit('conversation:read', { conversation_id: conversationId });
    }
  }, [user.id]);

  // Fetch anything that arrived while the socket was disconnected.
  const catchUp = useCallback(async () => {
    await loadConversations().catch(() => {});
    const threads = stateRef.current.messages;
    await Promise.all(Object.entries(threads).map(async ([id, thread]) => {
      const lastId = [...thread.items].reverse().find((item) => !item.pending && !item.failed)?.id;
      if (!lastId) return;
      try {
        const { data } = await api.get(`/conversations/${id}/messages`, { params: { after: lastId, limit: 100 } });
        if (data.messages.length) dispatch({ type: 'thread/loaded', id: Number(id), items: data.messages, mode: 'append' });
      } catch (_error) { /* conversation may be gone */ }
    }));
    if (activeRef.current) markRead(activeRef.current);
    loadNotifications().catch(() => {});
  }, [loadConversations, loadNotifications, markRead]);

  useEffect(() => {
    loadConversations().catch((error) => toast.error(errorMessage(error)));
    loadNotifications().catch(() => {});
    api.get('/settings').then(({ data }) => dispatch({ type: 'settings', settings: data.settings })).catch(() => {});
    api.get('/users/me/notification-preferences').then(({ data }) => { prefsRef.current = data.preferences; }).catch(() => {});
  }, [loadConversations, loadNotifications, toast]);

  useEffect(() => {
    const onConnect = () => {
      dispatch({ type: 'connected', value: true });
      if (hasConnected.current) catchUp();
      hasConnected.current = true;
    };
    const onDisconnect = async (reason) => {
      dispatch({ type: 'connected', value: false });
      // The server only disconnects us on purpose (session ended) — check whether we are still signed in.
      if (reason === 'io server disconnect') {
        const stillSignedIn = await refreshUser();
        if (stillSignedIn) socket.connect();
      }
    };
    const onConnectError = async (error) => {
      if (error.message === 'unauthorized') {
        const stillSignedIn = await refreshUser();
        if (!stillSignedIn) socket.disconnect();
      }
    };

    const onMessageNew = (message) => {
      const mine = message.sender.id === user.id;
      const conversation = stateRef.current.conversations[message.conversation_id];
      const isActive = activeRef.current === message.conversation_id && document.visibilityState === 'visible';
      const countUnread = !mine && message.message_type !== 'system' && !isActive;
      dispatch({ type: 'message/upsert', message, isNew: true, countUnread });
      if (!conversation) refreshConversation(message.conversation_id);
      if (mine || message.message_type === 'system') return;
      socket.emit('message:delivered', { message_id: message.id });
      if (isActive) {
        socket.emit('conversation:read', { conversation_id: message.conversation_id });
        return;
      }
      if (conversation?.is_muted) return;
      if (prefsRef.current.sound_enabled) playPing();
      if (prefsRef.current.desktop_enabled && document.visibilityState !== 'visible' && 'Notification' in window && Notification.permission === 'granted') {
        const title = conversation?.type === 'group' ? `${message.sender.display_name} · ${conversation.title}` : message.sender.display_name;
        const notification = new Notification(title, { body: previewFor(message), icon: '/brand/chattime-app-icon-white.svg', tag: `conversation-${message.conversation_id}` });
        notification.onclick = () => {
          window.focus();
          window.dispatchEvent(new CustomEvent('chattime:open-conversation', { detail: message.conversation_id }));
        };
      }
    };
    const onMessageUpdated = (message) => {
      dispatch({ type: 'message/upsert', message, isNew: false });
      const conversation = stateRef.current.conversations[message.conversation_id];
      if (conversation?.last_message?.id === message.id) {
        dispatch({ type: 'conversation/patch', id: conversation.id, patch: { last_message_preview: previewFor(message) } });
      }
      const pinned = stateRef.current.pinned[message.conversation_id];
      if (pinned?.id === message.id) dispatch({ type: 'pinned', conversationId: message.conversation_id, message: message.deleted_at ? null : message });
    };
    const onReactions = ({ conversation_id: conversationId, message_id: id, reactions }) => {
      dispatch({ type: 'message/patch', conversationId, id, patch: { reactions } });
    };
    const onStatus = ({ conversation_id: conversationId, statuses }) => dispatch({ type: 'message/statuses', conversationId, statuses });
    const onRead = ({ conversation_id: id }) => dispatch({ type: 'conversation/patch', id, patch: { unread_count: 0 } });
    const onPinned = ({ conversation_id: conversationId, message, only_if_id: onlyIfId }) => {
      if (onlyIfId && stateRef.current.pinned[conversationId]?.id !== onlyIfId) return;
      dispatch({ type: 'pinned', conversationId, message });
      dispatch({ type: 'conversation/patch', id: conversationId, patch: { pinned_message_id: message?.id || null } });
    };
    const onPresenceInitial = (ids) => dispatch({ type: 'presence/set', ids });
    const onPresence = ({ user_id: userId, online, last_seen_at: lastSeen }) => dispatch({ type: 'presence/update', userId, online, lastSeen });
    const onTyping = ({ conversation_id: conversationId, user_id: userId, display_name: name, typing }) => {
      const key = `${conversationId}:${userId}`;
      clearTimeout(typingTimers.current[key]);
      dispatch({ type: 'typing', conversationId, userId, name, typing });
      if (typing) {
        typingTimers.current[key] = setTimeout(() => dispatch({ type: 'typing', conversationId, userId, typing: false }), 6000);
      }
    };
    const onRefresh = ({ conversation_id: id }) => refreshConversation(id);
    const onNotification = (notification) => dispatch({ type: 'notifications/add', notification });
    const onNotificationRead = ({ id, all }) => dispatch({ type: 'notifications/read', id, all });
    const onUserUpdated = (updated) => dispatch({ type: 'user/updated', user: updated });
    const onSuspended = () => logout('Your account has been suspended. Contact support if you think this is a mistake.');
    const onSignedOut = ({ message }) => logout(message);
    const onAccountUpdated = () => refreshUser();
    const onSettings = () => api.get('/settings').then(({ data }) => dispatch({ type: 'settings', settings: data.settings })).catch(() => {});

    const handlers = {
      connect: onConnect,
      disconnect: onDisconnect,
      connect_error: onConnectError,
      'message:new': onMessageNew,
      'message:updated': onMessageUpdated,
      'message:reactions': onReactions,
      'message:status': onStatus,
      'conversation:read': onRead,
      'conversation:pinned': onPinned,
      'conversation:refresh': onRefresh,
      'presence:initial': onPresenceInitial,
      'presence:update': onPresence,
      'typing:update': onTyping,
      'notification:new': onNotification,
      'notification:read': onNotificationRead,
      'user:updated': onUserUpdated,
      'account:suspended': onSuspended,
      'account:signed_out': onSignedOut,
      'account:updated': onAccountUpdated,
      'settings:updated': onSettings,
    };
    for (const [event, handler] of Object.entries(handlers)) socket.on(event, handler);
    socket.connect();

    const onVisible = () => {
      if (document.visibilityState === 'visible' && activeRef.current) markRead(activeRef.current);
    };
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      for (const [event, handler] of Object.entries(handlers)) socket.off(event, handler);
      document.removeEventListener('visibilitychange', onVisible);
      socket.disconnect();
      hasConnected.current = false;
      Object.values(typingTimers.current).forEach(clearTimeout);
    };
  }, [user.id, catchUp, logout, markRead, refreshConversation, refreshUser]);

  const loadMessages = useCallback(async (conversationId, { older = false } = {}) => {
    const thread = stateRef.current.messages[conversationId];
    const params = { limit: 40 };
    if (older) {
      const firstId = thread?.items.find((item) => !item.pending && !item.failed)?.id;
      if (!firstId || !thread.hasMore) return;
      params.before = firstId;
    }
    const { data } = await api.get(`/conversations/${conversationId}/messages`, { params });
    dispatch({ type: 'thread/loaded', id: conversationId, items: data.messages, hasMore: data.has_more, mode: older ? 'prepend' : 'replace' });
  }, []);

  const setActive = useCallback((conversationId) => {
    activeRef.current = conversationId;
    if (conversationId) markRead(conversationId);
  }, [markRead]);

  const send = useCallback(async (conversationId, { body = '', replyTo = null, attachments = [] }, existingClientId = null) => {
    const clientId = existingClientId || uuid();
    const optimistic = {
      id: `tmp-${clientId}`,
      client_message_id: clientId,
      conversation_id: conversationId,
      message_type: attachments.length ? (attachments.every((a) => a.kind === 'image') ? 'image' : attachments[0].kind === 'audio' ? 'audio' : 'file') : 'text',
      body: body || null,
      sender: { id: user.id, display_name: user.display_name, username: user.username, avatar_url: user.avatar_url },
      reply_to: replyTo ? { id: replyTo.id, sender_name: replyTo.sender.display_name, preview: previewFor(replyTo) } : null,
      attachments,
      reactions: [],
      status: 'sending',
      created_at: new Date().toISOString(),
      pending: true,
      failed: false,
      retry: { body, replyTo, attachments },
    };
    dispatch({ type: 'message/upsert', message: optimistic, isNew: false });
    try {
      const { message } = await request('message:send', {
        conversation_id: conversationId,
        body,
        reply_to_message_id: replyTo?.id || null,
        attachment_ids: attachments.map((attachment) => attachment.id),
        client_message_id: clientId,
      });
      dispatch({ type: 'message/upsert', message, isNew: true, countUnread: false });
    } catch (error) {
      dispatch({ type: 'message/failed', conversationId, clientId, error: error.message });
    }
  }, [user]);

  const retry = useCallback((message) => {
    send(message.conversation_id, message.retry, message.client_message_id);
  }, [send]);

  const discard = useCallback((message) => {
    dispatch({ type: 'message/discard', conversationId: message.conversation_id, clientId: message.client_message_id });
  }, []);

  const editMessage = useCallback(async (message, body) => {
    const response = await request('message:edit', { message_id: message.id, body });
    dispatch({ type: 'message/upsert', message: response.message, isNew: false });
  }, []);

  const deleteMessage = useCallback(async (message) => {
    const response = await request('message:delete', { message_id: message.id });
    dispatch({ type: 'message/upsert', message: response.message, isNew: false });
  }, []);

  const toggleReaction = useCallback(async (message, emoji) => {
    const mine = message.reactions?.find((reaction) => reaction.emoji === emoji)?.user_ids.includes(user.id);
    const response = await request(mine ? 'reaction:remove' : 'reaction:add', { message_id: message.id, emoji });
    dispatch({ type: 'message/patch', conversationId: message.conversation_id, id: message.id, patch: { reactions: response.reactions } });
  }, [user.id]);

  const setPinned = useCallback(async (conversationId, messageId) => {
    const { data } = await api.put(`/conversations/${conversationId}/pin`, { message_id: messageId });
    dispatch({ type: 'pinned', conversationId, message: data.pinned_message });
  }, []);

  const setPreferences = useCallback(async (conversationId, patch) => {
    dispatch({ type: 'conversation/patch', id: conversationId, patch });
    try {
      const { data } = await api.patch(`/conversations/${conversationId}/preferences`, patch);
      dispatch({ type: 'conversation/upsert', conversation: data.conversation });
    } catch (error) {
      refreshConversation(conversationId);
      throw error;
    }
  }, [refreshConversation]);

  const openDirect = useCallback(async (userId) => {
    const { data } = await api.post('/conversations/direct', { user_id: userId });
    dispatch({ type: 'conversation/upsert', conversation: data.conversation });
    socket.emit('conversation:join', { conversation_id: data.conversation.id });
    return data.conversation;
  }, []);

  const addConversation = useCallback((conversation) => {
    dispatch({ type: 'conversation/upsert', conversation });
    socket.emit('conversation:join', { conversation_id: conversation.id });
  }, []);

  const removeConversation = useCallback((id) => dispatch({ type: 'conversation/remove', id }), []);

  const typingStart = useCallback((conversationId) => socket.emit('typing:start', { conversation_id: conversationId }), []);
  const typingStop = useCallback((conversationId) => socket.emit('typing:stop', { conversation_id: conversationId }), []);

  const markNotificationsRead = useCallback(async (id = null) => {
    dispatch({ type: 'notifications/read', id, all: !id });
    await (id ? api.patch(`/notifications/${id}/read`) : api.patch('/notifications/read-all'));
  }, []);

  const getState = useCallback(() => stateRef.current, []);

  const value = useMemo(() => ({
    state,
    getState,
    me: user,
    loadConversations,
    refreshConversation,
    loadMessages,
    loadNotifications,
    setActive,
    markRead,
    send,
    retry,
    discard,
    editMessage,
    deleteMessage,
    toggleReaction,
    setPinned,
    setPreferences,
    openDirect,
    addConversation,
    removeConversation,
    typingStart,
    typingStop,
    markNotificationsRead,
    setNotificationPrefs: (prefs) => { prefsRef.current = prefs; },
  }), [state, getState, user, loadConversations, refreshConversation, loadMessages, loadNotifications, setActive, markRead, send, retry, discard,
    editMessage, deleteMessage, toggleReaction, setPinned, setPreferences, openDirect, addConversation, removeConversation,
    typingStart, typingStop, markNotificationsRead]);

  return <ChatContext.Provider value={value}>{children}</ChatContext.Provider>;
}

export const useChat = () => useContext(ChatContext);

// Sorted list for the sidebar: pinned first, then most recent activity.
export function sortConversations(list) {
  return [...list].sort((a, b) => {
    if (a.is_pinned !== b.is_pinned) return a.is_pinned ? -1 : 1;
    const timeA = new Date(a.last_message_at || a.created_at).getTime();
    const timeB = new Date(b.last_message_at || b.created_at).getTime();
    return timeB - timeA;
  });
}
