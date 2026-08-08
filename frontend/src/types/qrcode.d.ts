declare module 'qrcode' {
  interface QrCodeToDataUrlOptions {
    errorCorrectionLevel?: 'L' | 'M' | 'Q' | 'H';
    margin?: number;
    width?: number;
  }

  const QRCode: {
    toDataURL(value: string, options?: QrCodeToDataUrlOptions): Promise<string>;
  };

  export default QRCode;
}
