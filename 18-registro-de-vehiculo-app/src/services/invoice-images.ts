import * as Crypto from 'expo-crypto';
import { Directory, File, Paths } from 'expo-file-system';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';

const invoiceDirectory = new Directory(Paths.document, 'facturas');

export async function persistInvoiceImage(uri: string, originalWidth: number) {
  const context = ImageManipulator.manipulate(uri);
  if (originalWidth > 1280) context.resize({ width: 1280 });
  const rendered = await context.renderAsync();
  const compressed = await rendered.saveAsync({ compress: 0.7, format: SaveFormat.JPEG });

  invoiceDirectory.create({ idempotent: true, intermediates: true });
  const destination = new File(invoiceDirectory, `${Crypto.randomUUID()}.jpg`);
  new File(compressed.uri).move(destination);
  return destination.uri;
}

export function removeInvoiceImage(uri: string | null | undefined) {
  if (!uri) return;
  const directoryPrefix = invoiceDirectory.uri.endsWith('/') ? invoiceDirectory.uri : `${invoiceDirectory.uri}/`;
  if (!uri.startsWith(directoryPrefix)) return;
  try {
    const image = new File(uri);
    if (image.exists) image.delete();
  } catch {
    // A missing local photo should not prevent editing or removing its maintenance record.
  }
}
