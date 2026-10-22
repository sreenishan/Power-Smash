// Class strings for the parts that load after the first touch of the form (the WhatsApp buttons), kept out of styles.ts so they are
// not part of the first load (review C-1). Same rules as styles.ts.
import { buttonBase } from './styles';

export const buttonSecondary = `${buttonBase} border-2 border-ps-court bg-surface text-ps-court hover:bg-ps-court-tint`;
