import React, { useState, useEffect, useRef } from "react";
import { SimplePool, Event, getEventHash, getSignature, nip04, nip19 } from "nostr-tools";
import { relayUrls } from "../config";
import LinkPreview from './LinkPreview';

interface ChatProps {
  privateKey: string;
  publicKey: string;
  pool: SimplePool;
}

interface Message {
  id: string;
  pubkey: string;
  content: string;
  created_at: number;
  isPrivate: boolean;
  recipient?: string;
  replyTo?: string; // ID del mensaje al que se responde
  replyContent?: string; // Contenido del mensaje al que se responde
}

const Chat: React.FC<ChatProps> = ({ privateKey, publicKey, pool }) => {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState<string>("");
  const [replyingTo, setReplyingTo] = useState<Message | null>(null);
  const [editingMessage, setEditingMessage] = useState<Message | null>(null); // Estado para el mensaje en edición
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const sub = pool.sub(relayUrls, [{ kinds: [1, 4], limit: 100 }]);

    sub.on("event", async (event: Event) => {
      try {
        let messageContent = event.content;
        let isPrivateMessage = event.kind === 4;

        if (isPrivateMessage && event.tags.some((tag) => tag[0] === "p")) {
          const recipientPubkey = event.tags.find((tag) => tag[0] === "p")?.[1];
          if (recipientPubkey === publicKey || event.pubkey === publicKey) {
            try {
              messageContent = await nip04.decrypt(privateKey, event.pubkey, event.content);
            } catch (error) {
              console.error("Error decrypting message:", error);
              return;
            }
          } else {
            return;
          }
        }

        const newMessage: Message = {
          id: event.id,
          pubkey: event.pubkey,
          content: messageContent,
          created_at: event.created_at,
          isPrivate: isPrivateMessage,
          recipient: event.tags.find((tag) => tag[0] === "p")?.[1],
        };

        if (!isPrivateMessage || newMessage.pubkey === publicKey || newMessage.recipient === publicKey) {
          setMessages((prevMessages) => {
            if (!prevMessages.find((msg) => msg.id === newMessage.id)) {
              return [...prevMessages, newMessage].sort((a, b) => a.created_at - b.created_at);
            }
            return prevMessages;
          });
        }
      } catch (error) {
        console.error("Error processing message:", error);
      }
    });

    return () => {
      sub.unsub();
    };
  }, [pool, publicKey, privateKey]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const sendMessage = async () => {
    if (!input.trim()) return;

    try {
      const event: Event<number> = {
        id: '',
        sig: '',
        kind: 1,
        pubkey: publicKey,
        created_at: Math.floor(Date.now() / 1000),
        tags: replyingTo ? [['e', replyingTo.id], ['p', replyingTo.pubkey]] : [],
        content: input,
      };

      // Si estamos editando un mensaje, eliminamos el mensaje original y enviamos uno nuevo
      if (editingMessage) {
        // Aquí podrías agregar lógica para marcar el mensaje como eliminado si es necesario
        const deleteEvent: Event<number> = {
          id: editingMessage.id, // ID del mensaje a eliminar
          sig: '',
          kind: 5, // Suponiendo que el tipo 5 es para eliminar mensajes
          pubkey: publicKey,
          created_at: Math.floor(Date.now() / 1000),
          tags: [],
          content: "Mensaje eliminado", // Mensaje de eliminación
        };

        // Publicar el evento de eliminación
        await pool.publish(relayUrls, deleteEvent);

        // Actualizar el estado de mensajes para reflejar la eliminación
        setMessages((prevMessages) => 
          prevMessages.filter((msg) => msg.id !== editingMessage.id)
        );
      }

      // Enviar el nuevo mensaje
      event.id = getEventHash(event);
      event.sig = getSignature(event, privateKey);

      await pool.publish(relayUrls, event);

      // Agregar el nuevo mensaje al estado
      const newMessage: Message = {
        id: event.id,
        pubkey: publicKey,
        content: input,
        created_at: event.created_at,
        isPrivate: event.kind === 4,
        recipient: event.tags.find((tag) => tag[0] === "p")?.[1],
      };
      setMessages((prevMessages) => [...prevMessages, newMessage].sort((a, b) => a.created_at - b.created_at));

      setInput("");
      setReplyingTo(null); // Limpiar el estado de respuesta
      setEditingMessage(null); // Limpiar el estado de edición
    } catch (error) {
      console.error("Error sending message:", error);
    }
  };

  const handleEditMessage = (msg: Message) => {
    setInput(msg.content); // Cargar el contenido del mensaje en el input
    setEditingMessage(msg); // Establecer el mensaje como el que se está editando
    setReplyingTo(null); // Limpiar el estado de respuesta al editar
  };

  const handleReply = (msg: Message) => {
    setInput(msg.content); // Cargar el contenido del mensaje en el input
    setReplyingTo(msg); // Establecer el mensaje como el que se está respondiendo
    setEditingMessage(null); // Limpiar el estado de edición al responder
  };

  const formatPubkey = (pubkey: string, short: boolean = false): string => {
    try {
      const npub = pubkey.startsWith('npub') ? pubkey : nip19.npubEncode(pubkey);
      return short ? `${npub.slice(0, 7)}` : npub;
    } catch (error) {
      console.error('Error formatting pubkey:', error);
      return pubkey;
    }
  };

  const isImageUrl = (url: string): boolean => {
    return /\.(jpg|jpeg|png|gif|webp)$/i.test(url);
  };

  const extractUrls = (text: string): string[] => {
    const urlRegex = /(https?:\/\/[^\s]+)/g;
    return text.match(urlRegex) || [];
  };

  const renderMessageContent = (content: string) => {
    const urls = extractUrls(content);
    if (urls.length === 0) {
      return <span>{content}</span>;
    }

    let lastIndex = 0;
    const elements: JSX.Element[] = [];

    urls.forEach((url, index) => {
      const startIndex = content.indexOf(url, lastIndex);
      
      // Agregar el texto antes de la URL
      if (startIndex > lastIndex) {
        elements.push(
          <span key={`text-${index}`}>
            {content.slice(lastIndex, startIndex)}
          </span>
        );
      }

      // Agregar la imagen o el enlace
      if (isImageUrl(url)) {
        elements.push(
          <div key={`image-${index}`} className="mt-2 max-w-sm">
            <img
              src={url}
              alt="Shared content"
              className="rounded-lg max-h-64 object-cover cursor-pointer hover:opacity-90"
              onClick={() => window.open(url, '_blank')}
              onError={(e) => {
                (e.target as HTMLImageElement).style.display = 'none';
              }}
            />
          </div>
        );
      } else {
        elements.push(
          <LinkPreview key={`link-${index}`} url={url} />
        );
      }

      lastIndex = startIndex + url.length;
    });

    // Agregar el texto restante después de la última URL
    if (lastIndex < content.length) {
      elements.push(
        <span key="text-final">
          {content.slice(lastIndex)}
        </span>
      );
    }

    return <div>{elements}</div>;
  };

  return (
    <div className="flex flex-col h-full">
      <div className="flex-grow overflow-y-auto mb-16 space-y-2 p-4">
        {messages.map((msg) => (
          <div key={msg.id} 
            className={`message p-2 rounded-lg ${
              msg.pubkey === publicKey 
                ? "self-end bg-green-600 text-white" 
                : "self-start bg-gray-100"
            }`}
          >
            <div className="flex items-center gap-2 mb-1">
              <span className="font-bold">{formatPubkey(msg.pubkey, true)}</span>
              {msg.isPrivate && (
                <span className="text-purple-300 text-sm">[Privado]</span>
              )}
            </div>
            <div className="break-words">
              {renderMessageContent(msg.content)}
            </div>
            <div className="mt-2 flex items-center gap-2">
              <button 
                onClick={() => handleReply(msg)} // Botón para responder
                className="text-blue-400 hover:text-blue-300 text-sm flex items-center gap-1"
              >
                <span>↩️</span>
                <span>Responder</span>
              </button>
              {msg.pubkey === publicKey && ( // Solo mostrar el botón de editar si el mensaje es del usuario
                <button 
                  onClick={() => handleEditMessage(msg)} // Botón para editar
                  className="text-blue-400 hover:text-blue-300 text-sm flex items-center gap-1"
                >
                  <span>✏️</span>
                  <span>Editar</span>
                </button>
              )}
              <MessageReactions 
                messageId={msg.id}
                pool={pool}
                publicKey={publicKey}
                privateKey={privateKey}
              />
            </div>
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>
      <div className="fixed bottom-0 left-0 right-0 bg-gray-800 p-2">
        {replyingTo && (
          <div className="bg-gray-700 p-2 mb-2 rounded flex justify-between items-center">
            <div>
              <span className="text-sm text-gray-400">
                Respondiendo a {formatPubkey(replyingTo.pubkey, true)}
              </span>
              <div className="text-sm truncate">{replyingTo.content}</div>
            </div>
            <button 
              onClick={() => setReplyingTo(null)} // Cancelar respuesta
              className="text-red-400 hover:text-red-300"
            >
              ✕
            </button>
          </div>
        )}
        <div className="flex">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyPress={(e) => {
              if (e.key === 'Enter') {
                sendMessage();
              }
            }}
            className="flex-grow bg-gray-700 text-green-500 p-2 rounded-l focus:outline-none"
            placeholder={
              replyingTo 
                ? replyingTo.isPrivate 
                  ? "Responder en privado..." 
                  : "Responder..."
                : editingMessage 
                  ? "Editando mensaje..." 
                  : "Type @npub... for private message..."
            }
          />
          <button 
            onClick={sendMessage} 
            className="bg-green-600 text-white px-4 py-2 rounded hover:bg-green-500"
          >
            {editingMessage ? "Actualizar" : "Enviar"}
          </button>
        </div>
      </div>
    </div>
  );
};

// Componente de Reacciones
interface ReactionProps {
  messageId: string;
  pool: SimplePool;
  publicKey: string;
  privateKey: string;
}

const MessageReactions: React.FC<ReactionProps> = ({ messageId, pool, publicKey, privateKey }) => {
  const [reactions, setReactions] = useState<Record<string, Set<string>>>({
    '👍': new Set(),
    '❤️': new Set(),
    '😂': new Set(),
    '🔥': new Set(),
  });

  useEffect(() => {
    const sub = pool.sub(relayUrls, [{
      kinds: [7],
      '#e': [messageId]
    }]);

    sub.on('event', (event: Event) => {
      const emoji = event.content;
      if (reactions[emoji]) {
        setReactions(prev => ({
          ...prev,
          [emoji]: new Set([...prev[emoji], event.pubkey])
        }));
      }
    });

    return () => {
      sub.unsub();
    };
  }, [messageId, pool]);

  const sendReaction = async (emoji: string) => {
    const event: Event = {
      kind: 7,
      pubkey: publicKey,
      created_at: Math.floor(Date.now() / 1000),
      tags: [['e', messageId]],
      content: emoji,
      id: '',
      sig: ''
    };

    event.id = getEventHash(event);
    event.sig = getSignature(event, privateKey);

    await pool.publish(relayUrls, event);
  };

  return (
    <div className="flex gap-2">
      {Object.entries(reactions).map(([emoji, users]) => (
        <button
          key={emoji}
          onClick={() => sendReaction(emoji)}
          className={`px-2 py-1 rounded text-sm ${
            users.has(publicKey) ? 'bg-green-600' : 'bg-gray-600 hover:bg-gray-500'
          }`}
        >
          {emoji} {users.size > 0 && users.size}
        </button>
      ))}
    </div>
  );
};

export default Chat;