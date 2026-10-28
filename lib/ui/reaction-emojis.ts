export const REACTION_EMOJIS = [
  { id: "thumbs-up", emoji: "👍", label: "Thumbs up", group: "Popular" },
  { id: "heart", emoji: "❤️", label: "Love", group: "Popular" },
  { id: "fire", emoji: "🔥", label: "Fire", group: "Popular" },
  { id: "laugh", emoji: "😂", label: "Laughing", group: "Popular" },
  { id: "eyes", emoji: "👀", label: "Eyes", group: "Popular" },
  { id: "sparkles", emoji: "✨", label: "Sparkles", group: "Popular" },
  { id: "hundred", emoji: "💯", label: "One hundred", group: "Popular" },
  { id: "party", emoji: "🎉", label: "Party", group: "Popular" },
  { id: "eggplant", emoji: "🍆", label: "Eggplant", group: "Popular" },
  { id: "smile", emoji: "😁", label: "Grinning", group: "Faces" },
  { id: "heart-eyes", emoji: "😍", label: "Heart eyes", group: "Faces" },
  { id: "wow", emoji: "😮", label: "Surprised", group: "Faces" },
  { id: "cry", emoji: "😭", label: "Crying", group: "Faces" },
  { id: "mind-blown", emoji: "🤯", label: "Mind blown", group: "Faces" },
  { id: "cool", emoji: "😎", label: "Cool", group: "Faces" },
  { id: "skull", emoji: "💀", label: "Skull", group: "Faces" },
  { id: "thinking", emoji: "🤔", label: "Thinking", group: "Faces" },
  { id: "salute", emoji: "🫡", label: "Salute", group: "Celebrate" },
  { id: "clap", emoji: "👏", label: "Applause", group: "Celebrate" },
  {
    id: "raised-hands",
    emoji: "🙌",
    label: "Raised hands",
    group: "Celebrate"
  },
  { id: "handshake", emoji: "🤝", label: "Handshake", group: "Celebrate" },
  { id: "diamond", emoji: "💎", label: "Diamond", group: "Celebrate" },
  { id: "heart-hands", emoji: "🫶", label: "Heart hands", group: "Celebrate" },
  { id: "trophy", emoji: "🏆", label: "Trophy", group: "Celebrate" },
  { id: "star", emoji: "🌟", label: "Glowing star", group: "Celebrate" }
] as const;

export function reactionEmoji(id: string) {
  return REACTION_EMOJIS.find(item => item.id === id);
}
