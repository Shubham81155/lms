import type { siteEn } from './o-site.en';

// हिन्दी संदेश for the site screens (spread into hi.ts).
export const siteHi: Record<keyof typeof siteEn, string> = {
  // Theme toggle
  'site.theme.toggle': 'थीम बदलें',
  'site.theme.toLight': 'लाइट थीम पर जाएँ',
  'site.theme.toDark': 'डार्क थीम पर जाएँ',

  // Deep link
  'site.deeplink.title': 'आपको वहाँ ले जा रहे हैं',
  'site.deeplink.wait': 'एक क्षण…',

  // CAPTCHA
  'site.captcha.failed': 'सुरक्षा जाँच चल नहीं सकी। फिर कोशिश की जा रही है…',
  'site.captcha.load':
    'सुरक्षा जाँच लोड नहीं हो सकी। अपना कनेक्शन जाँचें या किसी भी कंटेंट ब्लॉकर में challenges.cloudflare.com को अनुमति दें, फिर पृष्ठ को दोबारा लोड करें।',

  // Landing: header and hero
  'site.home.nav.roles': 'यह किसके लिए है',
  'site.home.nav.platform': 'प्लेटफ़ॉर्म',
  'site.home.nav.privacy': 'गोपनीयता',
  'site.home.badge': 'बहु-संगठन · ज़ीरो-ट्रस्ट · मानक-आधारित',
  'site.home.hero.title1': 'आपकी पूरी संस्था के लिए एक लर्निंग प्लेटफ़ॉर्म,',
  'site.home.hero.title2': 'डिज़ाइन से ही सुरक्षित।',
  'site.home.hero.body':
    'विद्यार्थियों, शिक्षकों और प्रशासकों के लिए कोर्स, मूल्यांकन, लाइव कक्षाएँ और सत्यापन-योग्य प्रमाणपत्र, जिसमें हर संगठन का डेटा अलग रहता है और हर कार्रवाई का ऑडिट होता है।',
  'site.home.hero.signIn': 'अपने पोर्टल में साइन इन करें',
  'site.home.hero.new':
    'ApexLMS पर नए हैं? अपना कॉलेज, स्कूल या कंपनी पंजीकृत करें; हमारी टीम हर अनुरोध की समीक्षा करती है और आपके प्रशासक को शुरू करने का लिंक ई-मेल करती है।',
  'site.home.hero.explore': 'प्लेटफ़ॉर्म देखें',
  'site.home.hero.lost': 'खाता है, लेकिन अपने संगठन का पता याद नहीं?',

  // Landing: preview card
  'site.home.preview.portal': 'विद्यार्थी पोर्टल',
  'site.home.preview.continue': 'पढ़ाई जारी रखें',
  'site.home.preview.inProgress.one': '{count} कोर्स जारी है',
  'site.home.preview.inProgress.other': '{count} कोर्स जारी हैं',
  'site.home.preview.course1': 'ऑर्गेनिक रसायन विज्ञान II',
  'site.home.preview.course2': 'डेटा स्ट्रक्चर',
  'site.home.preview.course3': 'अकादमिक लेखन',
  'site.home.preview.certificate': 'प्रमाणपत्र जारी हुआ: प्रयोगशाला सुरक्षा',
  'site.home.preview.verifiable': 'सार्वजनिक रूप से सत्यापन-योग्य',
  'site.home.greeting.morning': 'सुप्रभात',
  'site.home.greeting.afternoon': 'नमस्कार',
  'site.home.greeting.evening': 'शुभ संध्या',
  'site.home.greeting.welcome': 'फिर से स्वागत है',

  // Landing: standards
  'site.home.standards.label': 'समर्थित मानक',
  'site.home.standards.heading': 'खुले मानकों पर आधारित',

  // Landing: roles
  'site.home.roles.eyebrow': 'यह किसके लिए है',
  'site.home.roles.title': 'हर भूमिका के लिए अलग पोर्टल',
  'site.home.roles.body':
    'एक बार साइन इन करें और आप अपने लिए बने कार्यक्षेत्र में पहुँच जाते हैं, जहाँ पहुँच आपकी भूमिका और संस्था तक सीमित रहती है।',
  'site.home.role.students.title': 'विद्यार्थी',
  'site.home.role.students.body':
    'जहाँ छोड़ा था वहीं से पाठ शुरू करें, क्विज़ दें, असाइनमेंट जमा करें, लाइव कक्षाओं में शामिल हों और प्रमाणपत्र पाएँ।',
  'site.home.role.faculty.title': 'शिक्षक',
  'site.home.role.faculty.body':
    'कोर्स बनाएँ, रूब्रिक से ग्रेड दें, हर टेक्स्ट जमा-सामग्री की साहित्यिक चोरी जाँच की स्थिति देखें और हर बैच की प्रगति पर नज़र रखें।',
  'site.home.role.admins.title': 'प्रशासक',
  'site.home.role.admins.body':
    'एक ही कंसोल से संगठन जोड़ें, उपयोगकर्ता और भूमिकाएँ प्रबंधित करें, ऑडिट रिकॉर्ड देखें और डेटा-विषय अनुरोधों का जवाब दें।',

  // Landing: platform
  'site.home.platform.eyebrow': 'प्लेटफ़ॉर्म',
  'site.home.platform.title': 'पढ़ाने के लिए जो चाहिए, सब कुछ; जो नहीं चाहिए, कुछ नहीं',
  'site.home.feature.standards.title': 'मानक-आधारित सेवा',
  'site.home.feature.standards.body':
    'xAPI लर्निंग रिकॉर्ड स्टोर, LTI 1.3 Advantage टूल लॉन्च और SCIM 2.0 प्रोविज़निंग, OIDC या SAML सिंगल साइन-ऑन के साथ।',
  'site.home.feature.isolated.title': 'शुरू से अलग-अलग',
  'site.home.feature.isolated.body':
    'PostgreSQL रो-लेवल सिक्योरिटी हर संगठन को अलग रखती है; संवेदनशील फ़ील्ड AES-256-GCM से एन्क्रिप्ट किए जाते हैं।',
  'site.home.feature.audit.title': 'अपरिवर्तनीय ऑडिट रिकॉर्ड',
  'site.home.feature.audit.body':
    'एक बार लिखा जाने वाला ऑडिट लॉग दर्ज करता है कि किसने क्या और कब किया, जो मान्यता और अनुपालन समीक्षाओं के लिए तैयार रहता है।',
  'site.home.feature.certificates.title': 'सत्यापन-योग्य प्रमाणपत्र',
  'site.home.feature.certificates.body':
    'हर कोर्स प्रमाणपत्र पर एक विशिष्ट संख्या होती है, जिसे नियोक्ता और अन्य संस्थाएँ सार्वजनिक रूप से जाँच सकती हैं।',
  'site.home.feature.integrity.title': 'शैक्षणिक ईमानदारी',
  'site.home.feature.integrity.body':
    'टेक्स्ट जमा-सामग्री हस्ताक्षरित और दोबारा आज़माए जाने वाले अनुरोधों से साहित्यिक चोरी जाँच सेवा को भेजी जाती है, और नतीजे ग्रेडिंग के समय दिखते हैं।',
  'site.home.feature.live.title': 'लाइव कक्षाएँ',
  'site.home.feature.live.body': 'कोर्स सामग्री के साथ रीयल-टाइम सत्र चलाएँ, साथ में अकादमिक कैलेंडर और सूचनाएँ भी।',

  // Landing: privacy
  'site.home.privacy.title': 'विद्यार्थियों की गोपनीयता, प्लेटफ़ॉर्म में ही शामिल',
  'site.home.privacy.body':
    'GDPR और FERPA के अधिकार प्लेटफ़ॉर्म स्वयं संभालता है: डेटा निर्यात, डायरेक्टरी से बाहर रहना और डेटा मिटाना ऑडिट किए गए गोपनीयता एंडपॉइंट से होते हैं, हाथ से डेटाबेस बदलकर नहीं।',
  'site.home.privacy.export': 'अनुरोध पर किसी व्यक्ति के डेटा का निर्यात',
  'site.home.privacy.optOut': 'विद्यार्थियों के लिए डायरेक्टरी से बाहर रहने का विकल्प',
  'site.home.privacy.erasure': 'डेटा मिटाना, पर शैक्षणिक रिकॉर्ड सुरक्षित रहते हैं',
  'site.home.privacy.encryption': 'संग्रहित डेटा का फ़ील्ड-स्तर एन्क्रिप्शन',

  // Landing: closing and footer
  'site.home.cta.title': 'कक्षा में जाने के लिए तैयार?',
  'site.home.cta.body': 'साइन इन करने के लिए अपनी संस्था से मिला खाता इस्तेमाल करें, या अपनी संस्था को जोड़ें।',
  'site.home.footer.rights': '© ApexLMS एंटरप्राइज़ प्लेटफ़ॉर्म। सर्वाधिकार सुरक्षित।',
  'site.home.footer.forgot': 'पासवर्ड भूल गए',

  // Registration: form
  'site.reg.title': 'अपना संगठन पंजीकृत करें',
  'site.reg.intro':
    'हमें अपनी संस्था के बारे में बताएँ। हम नीचे दिए संपर्क व्यक्ति को अनुरोध की पुष्टि का लिंक ई-मेल करते हैं; इसके बाद प्लेटफ़ॉर्म टीम उसकी समीक्षा करती है। मंज़ूरी के बाद संपर्क व्यक्ति को पासवर्ड चुनने के लिए ई-मेल मिलता है और वह आपके संगठन का प्रशासक बन जाता है, जो फिर शिक्षकों और विद्यार्थियों को आमंत्रित करता है।',
  'site.reg.optional': '(वैकल्पिक)',
  'site.reg.org.legend': 'संगठन',
  'site.reg.org.name': 'संगठन का नाम',
  'site.reg.org.namePlaceholder': 'जैसे सेंट मैरी कॉलेज',
  'site.reg.org.slug': 'वेब पता',
  'site.reg.org.type': 'संस्था का प्रकार',
  'site.reg.org.country': 'देश',
  'site.reg.org.website': 'वेबसाइट',
  'site.reg.org.learners': 'अनुमानित शिक्षार्थियों की संख्या',
  'site.reg.type.UNIVERSITY': 'विश्वविद्यालय',
  'site.reg.type.COLLEGE': 'महाविद्यालय',
  'site.reg.type.SCHOOL': 'विद्यालय',
  'site.reg.type.TRAINING_PROVIDER': 'प्रशिक्षण संस्था',
  'site.reg.type.COMPANY': 'कंपनी',
  'site.reg.type.OTHER': 'अन्य',
  'site.reg.contact.legend': 'संपर्क व्यक्ति (आपका पहला प्रशासक)',
  'site.reg.contact.first': 'पहला नाम',
  'site.reg.contact.last': 'उपनाम',
  'site.reg.contact.email': 'कार्य का ई-मेल',
  'site.reg.contact.emailHint': 'पुष्टि का लिंक हम पहले यहीं भेजते हैं; मंज़ूरी का ई-मेल और आपका साइन-इन भी इसी पते से होंगे।',
  'site.reg.contact.phone': 'फ़ोन',
  'site.reg.contact.message': 'क्या हमें कुछ और जानना चाहिए?',
  'site.reg.contact.messagePlaceholder': 'उदाहरण: आप कब शुरू करना चाहेंगे, या आज कौन-से सिस्टम इस्तेमाल करते हैं।',
  'site.reg.terms':
    'मैं इस संगठन को पंजीकृत करने के लिए अधिकृत हूँ, और मैं सहमत हूँ कि प्लेटफ़ॉर्म टीम इस अनुरोध के बारे में मुझसे संपर्क कर सकती है।',
  'site.reg.submit': 'पंजीकरण अनुरोध भेजें',
  'site.reg.sending': 'भेजा जा रहा है…',
  'site.reg.already': 'पहले से पंजीकृत हैं?',

  // Registration: web address status
  'site.reg.slug.checking': 'जाँच हो रही है…',
  'site.reg.slug.available': 'उपलब्ध है',
  'site.reg.slug.willBe': '· आपका पता होगा {address}',
  'site.reg.slug.error': 'अभी जाँच नहीं हो सकी; अनुरोध भेजने पर हम जाँच लेंगे।',
  'site.reg.slug.help': 'आपके लोग अपने संगठन में साइन इन करने के लिए इसी पते का इस्तेमाल करेंगे।',
  'site.reg.slug.reason.invalid': '3 से 40 छोटे अक्षर (a-z), अंक या हाइफ़न इस्तेमाल करें; शुरुआत और अंत अक्षर या अंक से होना चाहिए।',
  'site.reg.slug.reason.reserved': 'यह पता आरक्षित है। कोई और चुनें।',
  'site.reg.slug.reason.taken': 'इस पते का इस्तेमाल कोई और संगठन पहले से कर रहा है।',
  'site.reg.slug.reason.pending': 'किसी ने यह पता पहले ही माँग लिया है। कोई और चुनें।',

  // Registration: validation and errors
  'site.reg.err.orgName': 'संगठन का नाम लिखें।',
  'site.reg.err.orgNameLink': 'नाम में वेब पते न लिखें।',
  'site.reg.err.orgNameChars': "नाम में केवल अक्षर, अंक, खाली जगह और . , ' & ( ) - का इस्तेमाल करें।",
  'site.reg.err.personName': 'संपर्क व्यक्ति का पहला नाम और उपनाम लिखें।',
  'site.reg.err.personNameChars': "नामों में केवल अक्षर, खाली जगह और . ' - का इस्तेमाल करें।",
  'site.reg.err.website': 'वेबसाइट https:// से शुरू होनी चाहिए।',
  'site.reg.err.learners': 'अनुमानित शिक्षार्थियों की संख्या पूर्ण संख्या होनी चाहिए।',
  'site.reg.err.captcha': 'पहले सुरक्षा जाँच पूरी करें।',
  'site.reg.err.conflict': 'वह वेब पता अभी-अभी किसी और ने ले लिया या माँग लिया है। कोई और चुनें।',
  'site.reg.err.closed': 'नए संगठनों का पंजीकरण फ़िलहाल बंद है। कृपया हमसे संपर्क करें।',
  'site.reg.err.tooMany': 'आपके नेटवर्क से बहुत ज़्यादा अनुरोध आए हैं। कृपया बाद में फिर कोशिश करें।',
  'site.reg.err.wrong': 'कुछ गड़बड़ हो गई। कृपया फिर कोशिश करें।',

  // Registration: e-mail sent
  'site.reg.sent.title': 'अपना ई-मेल देखें',
  'site.reg.sent.bodyBy':
    'हमने {email} पर पुष्टि का लिंक भेजा है। अपना अनुरोध प्लेटफ़ॉर्म टीम तक भेजने के लिए इसे {when} तक खोलें। तब तक इस पते को कोई और नहीं माँग सकता।',
  'site.reg.sent.bodyWithin':
    'हमने {email} पर पुष्टि का लिंक भेजा है। अपना अनुरोध प्लेटफ़ॉर्म टीम तक भेजने के लिए इसे 24 घंटे के भीतर खोलें। तब तक इस पते को कोई और नहीं माँग सकता।',
  'site.reg.sent.requested': 'माँगा गया पता: {address}',
  'site.reg.sent.noEmail': 'ई-मेल नहीं मिला? अपना स्पैम फ़ोल्डर देखें। लिंक की अवधि समाप्त हो जाए तो अनुरोध दोबारा भेज दें।',

  // Registration: confirmation page
  'site.reg.confirm.working': 'आपके अनुरोध की पुष्टि हो रही है…',
  'site.reg.confirm.tooMany': 'आपके नेटवर्क से बहुत ज़्यादा प्रयास हुए हैं। कृपया बाद में फिर कोशिश करें।',
  'site.reg.confirm.wrong': 'कुछ गड़बड़ हो गई। कृपया लिंक फिर से खोलकर देखें।',
  'site.reg.confirm.failedTitle': 'अनुरोध की पुष्टि नहीं हो सकी',
  'site.reg.confirm.restart': 'नया अनुरोध भेजें',
  'site.reg.confirm.titlePending': 'अनुरोध की पुष्टि हो गई',
  'site.reg.confirm.titleDecided': 'इस अनुरोध पर फ़ैसला हो चुका है',
  'site.reg.confirm.pending': 'धन्यवाद। {name} के लिए आपका अनुरोध अब प्लेटफ़ॉर्म टीम के पास है।',
  'site.reg.confirm.approved': '{name} को मंज़ूरी मिल गई है। {email} पर पासवर्ड चुनने के लिंक वाला ई-मेल देखें।',
  'site.reg.confirm.rejected': 'हमने फ़ैसले के बारे में {email} पर ई-मेल भेजा है।',
  'site.reg.confirm.declined': 'अनुरोध अस्वीकार होने पर हम आपको कारण ई-मेल करेंगे।',
  'site.reg.step1': 'प्लेटफ़ॉर्म टीम आपके अनुरोध की समीक्षा करती है, आमतौर पर एक या दो कार्यदिवस में।',
  'site.reg.step2': 'मंज़ूरी मिलने पर {email} पर पासवर्ड चुनने के लिंक वाला ई-मेल आता है। लिंक 7 दिन तक मान्य रहता है।',
  'site.reg.step3': 'आप {address} पर उसके प्रशासक के रूप में साइन इन करते हैं और अपने शिक्षकों और शिक्षार्थियों को आमंत्रित करते हैं।',
  'site.reg.step3.fallback': 'आपके संगठन का पता',
};
