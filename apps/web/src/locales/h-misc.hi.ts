import type { miscEn } from './h-misc.en';

// हिन्दी संदेश for shared helpers (misc), spread into hi.ts.
export const miscHi: Record<keyof typeof miscEn, string> = {
  'mx.ai.off.NOT_ON_PLAN': 'AI सहायता आपके संगठन की योजना में शामिल नहीं है।',
  'mx.ai.off.TURNED_OFF': 'किसी व्यवस्थापक ने AI सहायता बंद कर दी है।',
  'mx.ai.off.NOT_CONFIGURED':
    'AI सहायता अभी सेट नहीं की गई है। व्यवस्थापक प्रशासन › योजना और इंटीग्रेशन में प्रदाता की कुंजी जोड़ सकता है।',
  'mx.media.what.both': 'कैमरा और माइक्रोफ़ोन',
  'mx.media.what.camera': 'कैमरा',
  'mx.media.what.microphone': 'माइक्रोफ़ोन',
  'mx.media.denied':
    'इस परीक्षा के लिए आपका {what} ज़रूरी है। अपने ब्राउज़र में अनुमति दें (एड्रेस बार में दिया गया आइकन), फिर दोबारा शुरू करें दबाएँ।',
  'mx.media.notFound': 'कोई {what} नहीं मिला। उसे जोड़ें और दोबारा शुरू करें दबाएँ।',
  'mx.media.inUse': 'आपका {what} किसी दूसरे ऐप में उपयोग हो रहा है। उसे बंद करें और दोबारा शुरू करें दबाएँ।',
  'mx.media.failed': 'आपका {what} शुरू नहीं हो सका।',
  'mx.media.detectorFailed': 'इस ब्राउज़र में चेहरे की पहचान शुरू नहीं हो सकी। आपका कैमरा आपको दिखता रहेगा, लेकिन कुछ भी जाँचा नहीं जाएगा।',
};
