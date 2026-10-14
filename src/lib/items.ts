/** What customers can bring. Keys are stored on reservations.items. */
export const ITEM_TYPES = {
  kitchen_knives: 'Kitchen knives',
  japanese_knives: 'Japanese knives',
  serrated: 'Serrated knives',
  scissors: 'Scissors / shears',
  other: 'Other tools',
} as const;

export type ItemKey = keyof typeof ITEM_TYPES;
