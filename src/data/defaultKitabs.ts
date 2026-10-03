import { KitabDocument, HasyiyahNote } from '../types/kitab';

export const DEFAULT_KITABS: KitabDocument[] = [
  {
    id: 'tang-ketab-induk-01',
    catalogNumber: 'TK-2026.01',
    title: 'Tang Kitab: Ushul Hikmah & Adab Penuntut Ilmu',
    subtitle: 'Naskah Induk Catatan Pribadi, Metodologi Telaah, dan Etika Keilmuan',
    author: 'Koleksi Pribadi Tang Kitab',
    category: 'Adab & Ushul Ilmu',
    language: 'Indonesia · Arab',
    totalPages: 10,
    lastReadPage: 1,
    bookmarks: [1, 4],
    addedAt: '14 Oktober 2026',
    isUploadedPdf: false,
    fileSizeLabel: 'Naskah Digital (1.4 MB)',
    coverTone: 'bronze',
    chapters: [
      { id: 'ch-1', number: '01', title: 'Muqaddimah & Niat Menuntut Ilmu', startPage: 1 },
      { id: 'ch-2', number: '02', title: 'Tartib Membaca & Mengikat Makna', startPage: 3 },
      { id: 'ch-3', number: '03', title: 'Adab Hasyiyah & Catatan Pinggir', startPage: 6 },
      { id: 'ch-4', number: '04', title: 'Muzakarah & Keberkahan Sanad', startPage: 9 },
    ],
    pages: [
      {
        pageNumber: 1,
        chapterTitle: 'Bab I · Muqaddimah & Niat Menuntut Ilmu',
        arabicMatan: 'بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ — الْحَمْدُ لِلَّهِ الَّذِي عَلَّمَ بِالْقَلَمِ، عَلَّمَ الْإِنْسَانَ مَا لَمْ يَعْلَمْ.',
        paragraphs: [
          'Segala puji bagi Dzat yang telah memuliakan manusia dengan perantaraan pena dan lembaran-lembaran kitab. Naskah "Tang Kitab" ini dihimpun sebagai rumah bacaan pribadi yang menyatukan ketenangan lembaran kertas klasik dengan kemudahan telaah lintas ruang.',
          'Para ulama terdahulu senantiasa mengingatkan bahwa ilmu bukanlah sekadar tumpukan riwayat yang dihafal di luar kepala, melainkan cahaya ketundukan hati yang menetap di dalam dada lalu membuahkan ketepatan amal perbuatan.',
          'Ketika seorang penuntut ilmu membuka lembaran kitabnya di pagi maupun keheningan malam, hendaklah ia memulai dengan membersihkan niat: mencari keridhaan Ilahi, mengangkat kebodohan dari diri sendiri, serta menghidupkan warisan hikmah agar tidak padam ditelan zaman.'
        ],
        footnote: 'Cat. Katalog TK-2026.01: Disalin dan disunting ulang untuk format pembaca PocketBook Tang Kitab.'
      },
      {
        pageNumber: 2,
        chapterTitle: 'Bab I · Muqaddimah & Niat Menuntut Ilmu',
        arabicMatan: 'الْعِلْمُ صَيْدٌ وَالْكِتَابَةُ قَيْدُهُ، قَيِّدْ صُيُودَكَ بِالْحِبَالِ الْوَائِقَهْ.',
        paragraphs: [
          'Sebagaimana diungkapkan dalam syair masyhur Imam Asy-Syafi’i rahimahullah: "Ilmu itu ibarat hewan buruan, sedangkan tulisan adalah tali pengikatnya. Maka ikatlah buruanmu dengan tali-tali yang kokoh."',
          'Di era dokumen digital, sering kali ratusan berkas PDF menumpuk di dalam ruang penyimpanan tanpa pernah disentuh secara mendalam. Mengubah berkas PDF menjadi format buku saku (PocketBook) yang tenang, berhalaman rapi, dan bebas gangguan adalah ikhtiar mengembalikan adab membaca secara perlahan (ta’anni).',
          'Setiap halaman yang dibalik secara sadar membantu ingatan membangun peta spasial: di sudut mana sebuah kaidah tertulis, dan di tepi mana sebuah catatan syarah ditorehkan.'
        ],
        footnote: 'Rujukan: Diwan Asy-Syafi’i, Bab Keutamaan Mencatat Faidah Ilmu.'
      },
      {
        pageNumber: 3,
        chapterTitle: 'Bab II · Tartib Membaca & Mengikat Makna',
        arabicMatan: 'مَنْ لَمْ يُتْقِنِ الْأُصُولَ حُرِمَ الْوُصُولَ، وَمَنْ رَامَ الْعِلْمَ جُمْلَةً ذَهَبَ عَنْهُ جُمْلَةً.',
        paragraphs: [
          'Kaidah emas dalam menelaah kitab-kitab induk maupun risalah ringkas adalah mendahulukan yang pokok (ushul) sebelum memasuki cabang-cabang perincian (furu’). Barangsiapa tidak mengokohkan fondasi dasarnya, niscaya ia akan terhalang dari pemahaman yang utuh.',
          'Dalam tradisi halaqah dan pustaka pribadi, pembacaan sebuah kitab dibagi menjadi tiga tahapan berjenjang: pertama, pembacaan gambaran umum (tashawwur ‘amm) untuk mengenali struktur bab; kedua, pembacaan tahqiq untuk mengurai setiap istilah kunci; dan ketiga, perenungan kembali (muraja’ah) sembari memberi catatan pinggir.',
          'Melalui fitur penanda halaman dan lompatan bab di Tang Kitab, pembaca dianjurkan menyelesaikan satu fasal secara utuh sebelum berpindah ke fasal berikutnya.'
        ],
        footnote: 'Kaidah Ushul: "Man lam yutqinil ushul hurimal wushul."'
      },
      {
        pageNumber: 4,
        chapterTitle: 'Bab II · Tartib Membaca & Mengikat Makna',
        arabicMatan: 'قَلِيلٌ دَائِمٌ خَيْرٌ مِنْ كَثِيرٍ مُنْقَطِعٍ.',
        paragraphs: [
          'Amalan menelaah kitab yang sedikit namun dilakukan secara ajeg (mudawamah) jauh lebih utama dan membekas dibandingkan membaca puluhan halaman sekaligus dalam satu malam namun kemudian terputus berbulan-bulan.',
          'Tetapkanlah wirid bacaan harian pada kitab pribadimu—misalnya dua hingga empat halaman setiap selesai subuh atau menjelang istirahat malam. Keajegan inilah yang membuat batin pembaca menyatu dengan jalan pikiran sang mushannif (penulis kitab).',
          'Apabila menjumpai kalimat yang musykil (sulit dipahami), jangan tergesa-gesa melompatinya. Berilah tanda pada halaman tersebut, catat pertanyaannya di kolom Hasyiyah, lalu bandingkan dengan penjelasan di bab-bab selanjutnya.'
        ],
        footnote: 'Wirid Pustaka: Disarankan membaca minimal 2 lembaran ganda (4 halaman) setiap hari.'
      },
      {
        pageNumber: 5,
        chapterTitle: 'Bab II · Tartib Membaca & Mengikat Makna',
        paragraphs: [
          'Perhatikanlah perbedaan karakter antara teks Matan dan teks Syarah. Matan disusun dengan kalimat yang sangat padat, hemat kata, namun kaya akan cakupan makna (jawami’ul kalim). Setiap huruf dan kata sambung di dalam matan memiliki konsekuensi hukum atau filosofis.',
          'Adapun Syarah hadir untuk membentangkan apa yang terlipat di dalam matan: menjelaskan batasan definisi (ta’rif), memberikan contoh kasus, serta menjawab kemungkinan sanggahan.',
          'Ketika Anda mengunggah dokumen PDF kitab pribadi ke dalam Tang Kitab, sistem secara otomatis merapikan paragraf-paragraf tersebut agar nyaman dibaca selayaknya buku cetak berjilid.'
        ]
      },
      {
        pageNumber: 6,
        chapterTitle: 'Bab III · Adab Hasyiyah & Catatan Pinggir',
        arabicMatan: 'حَاشِيَةُ الْكِتَابِ مِرْآةُ فَهْمِ الْقَارِئِ وَأَثَرُ تَدَبُّرِهِ.',
        paragraphs: [
          'Sejak berabad-abad silam, naskah-naskah manuskrip Nusantara dan Timur Tengah selalu memiliki ruang kosong yang lebar di tepi halaman. Ruang kosong itu bukan ketidaksengajaan, melainkan tempat bagi pembaca untuk menuliskan Hasyiyah (catatan pinggir) dan Ta’liq (komentar ringkas).',
          'Catatan pinggir adalah cermin dari kedalaman tadabbur seorang pembaca. Di sanalah ia mencatat arti kosakata langka, menuliskan rujukan silang ke kitab lain, atau merumuskan kesimpulan praktis.',
          'Di dalam aplikasi Tang Kitab ini, tradisi Hasyiyah dihidupkan kembali melalui panel Catatan Hasyiyah di sisi halaman. Setiap catatan terikat secara presisi pada nomor halaman tempat gagasan tersebut ditemukan.'
        ],
        footnote: 'Tradisi Filologi: Margin lebar pada naskah kuno dirancang khusus untuk transmisi syarah antar-generasi.'
      },
      {
        pageNumber: 7,
        chapterTitle: 'Bab III · Adab Hasyiyah & Catatan Pinggir',
        paragraphs: [
          'Agar catatan pribadi tidak bercampur aduk, para peneliti kitab membagi catatan pinggir ke dalam empat kategori utama:',
          '1. Syarah & Uraian: Penjelasan tambahan atas kalimat yang terlalu ringkas di dalam naskah utama.\n2. Makna & Mufradat: Terjemahan istilah teknis, kosakata bahasa Arab/daerah, atau definisi terminologis.\n3. Dalil & Rujukan: Pencantuman ayat, hadits, atau nomor halaman dari kitab pembanding.\n4. Pertanyaan Muzakarah: Hal-hal yang masih memerlukan diskusi lebih lanjut bersama guru atau sahabat sejawat.',
          'Gunakanlah keempat kategori tersebut saat menambahkan catatan pada halaman yang sedang Anda baca.'
        ]
      },
      {
        pageNumber: 8,
        chapterTitle: 'Bab III · Adab Hasyiyah & Catatan Pinggir',
        paragraphs: [
          'Selain catatan teks, penanda halaman (bookmark) berfungsi sebagai pita pembatas sebagaimana pita kain yang terselip di antara jilidan kitab kulit.',
          'Jangan menandai terlalu banyak halaman tanpa tujuan yang jelas. Gunakan pita penanda halaman untuk: (a) batas terakhir bacaan harian, (b) halaman yang memuat kaidah induk yang sering dirujuk ulang, atau (c) bagian yang sedang dihafalkan.',
          'Dengan demikian, setiap kali Anda membuka kembali Tang Kitab, Anda dapat langsung melanjutkan pengembaraan intelektual tanpa kehilangan jejak.'
        ]
      },
      {
        pageNumber: 9,
        chapterTitle: 'Bab IV · Muzakarah & Keberkahan Sanad',
        arabicMatan: 'حَيَاةُ الْعِلْمِ مُذَاكَرَتُهُ، وَزَكَاةُ الْعِلْمِ نَشْرُهُ.',
        paragraphs: [
          'Hidupnya ilmu adalah dengan muzakarah (saling berdiskusi dan mengingatkan), sedangkan zakat dari ilmu adalah mengajarkannya kepada orang yang membutuhkan.',
          'Sebuah kitab pribadi yang telah selesai dibaca dan dipenuhi catatan hasyiyah yang matang merupakan warisan intelektual yang sangat berharga. Apa yang hari ini Anda catat dengan teliti, kelak akan memudahkan Anda ketika hendak menyampaikan kembali intisari kitab tersebut di majelis ilmu maupun tulisan.',
          'Jagalah kebersihan hati dari sifat ujub (membanggakan diri) ketika telah menamatkan banyak kitab. Semakin luas lautan kitab yang diselami, semakin sadar seorang hamba betapa sedikit pengetahuan yang ia miliki.'
        ]
      },
      {
        pageNumber: 10,
        chapterTitle: 'Bab IV · Muzakarah & Keberkahan Sanad',
        arabicMatan: 'تَمَّ الْكِتَابُ بِعَوْنِ اللَّهِ الْمَلِكِ الْوَهَّابِ.',
        paragraphs: [
          'Demikianlah naskah induk pertama dalam pustaka Tang Kitab ini ditutup. Semoga fasilitas pembaca model PocketBook ini menjadi wasilah kemudahan bagi setiap pecinta ilmu dalam merawat, membaca, dan mengkaji kitab-kitab PDF pribadinya di mana pun berada.',
          'Silakan gunakan tombol "+ Masukkan PDF Kitab" di bilah atas untuk memasukkan dokumen PDF kitab koleksi Anda sendiri. Seluruh dokumen diproses secara langsung di peramban Anda dan disajikan ke dalam lembaran kitab yang teduh di mata.',
          'Walhamdulillahi Rabbil ‘Alamin.'
        ],
        footnote: 'Khatimah Naskah Induk Tang Kitab — Diselesaikan dengan penuh kesyukuran.'
      }
    ]
  },
  {
    id: 'risalah-qawaid-02',
    catalogNumber: 'TK-2026.02',
    title: 'Risalah Qawaid Fiqhiyyah & Kaidah Hukum',
    subtitle: 'Ringkasan Lima Kaidah Pokok Beserta Cabang dan Penerapannya',
    author: 'Syaikh Ahmad bin Muhammad Al-Hamaawi (Saduran)',
    category: 'Ushul & Qawaid',
    language: 'Indonesia · Arab',
    totalPages: 6,
    lastReadPage: 1,
    bookmarks: [2],
    addedAt: '09 Oktober 2026',
    isUploadedPdf: false,
    fileSizeLabel: 'Naskah Digital (920 KB)',
    coverTone: 'lapis',
    chapters: [
      { id: 'qf-1', number: '01', title: 'Al-Umuru Bi Maqashidiha (Segala Urusan Tergantung Niat)', startPage: 1 },
      { id: 'qf-2', number: '02', title: 'Al-Yaqinu La Yuzalu Bisy-Syakk (Keyakinan & Keraguan)', startPage: 3 },
      { id: 'qf-3', number: '03', title: 'Al-Masyaqqatu Tajlibut Taisir (Kemudahan dalam Kesulitan)', startPage: 5 },
    ],
    pages: [
      {
        pageNumber: 1,
        chapterTitle: 'Kaidah I · Segala Urusan Tergantung pada Tujuannya',
        arabicMatan: 'الْأُمُورُ بِمَقَاصِدِهَا',
        paragraphs: [
          'Kaidah pokok pertama yang menjadi poros bagi sebagian besar bab fikih dan muamalah adalah: "Al-Umuru Bi Maqashidiha" — setiap tindakan dan urusan manusia dinilai berdasarkan niat serta maksud yang melatarbelakanginya.',
          'Suatu perbuatan lahiriah yang tampak serupa dapat memiliki status hukum yang berbeda sama sekali apabila dilandasi oleh tujuan batin yang berbeda. Memberikan harta kepada seseorang bisa bernilai sedekah, hibah, pinjaman, atau bahkan suap yang terlarang, semata-mata bergantung pada akad dan niat di dalamnya.',
          'Oleh sebab itu, para fuqaha menempatkan pembahasan niat di gerbang pertama setiap kitab ibadah maupun muamalah.'
        ],
        footnote: 'Kaidah Kubra Pertama: Disepakati oleh seluruh mazhab fikih.'
      },
      {
        pageNumber: 2,
        chapterTitle: 'Kaidah I · Segala Urusan Tergantung pada Tujuannya',
        arabicMatan: 'الْعِبْرَةُ فِي الْعُقُودِ لِلْمَقَاصِدِ وَالْمَعَانِى لَا لِلْأَلْفَاظِ وَالْمَبَانِي.',
        paragraphs: [
          'Cabang penting dari kaidah pertama ini dalam bidang transaksi adalah: "Yang menjadi pegangan utama di dalam akad-akad adalah maksud dan substansi maknanya, bukan semata-mata bentuk lafaz dan susunan katanya."',
          'Apabila dua pihak menyepakati suatu transaksi dengan istilah baru di zaman modern, maka yang diperiksa oleh seorang peneliti hukum bukanlah nama luarnya, melainkan hakikat pertukaran hak dan kewajiban yang terjadi di dalamnya.'
        ]
      },
      {
        pageNumber: 3,
        chapterTitle: 'Kaidah II · Keyakinan Tidak Gugur oleh Keraguan',
        arabicMatan: 'الْيَقِينُ لَا يُزَالُ بِالشَّكِّ',
        paragraphs: [
          'Kaidah pokok kedua menetapkan prinsip kepastian hukum: "Al-Yaqinu la yuzalu bisy-syakk" — sesuatu yang telah tegak di atas keyakinan tidak dapat dibatalkan hanya karena datangnya keraguan yang bersifat spekulatif.',
          'Secara epistemologis, keyakinan (al-yaqin) memiliki derajat kekuatan yang jauh lebih kokoh dibandingkan keraguan (asy-syakk). Sesuatu yang kokoh hanya dapat digeser oleh bukti baru yang sama-sama meyakinkan.',
          'Dari kaidah induk ini lahirlah prinsip "Al-Ashlu Baqa’u Ma Kana ‘Ala Ma Kana" — hukum asal segala sesuatu adalah tetap berlangsungnya keadaan semula sampai terbukti adanya perubahan.'
        ]
      },
      {
        pageNumber: 4,
        chapterTitle: 'Kaidah II · Keyakinan Tidak Gugur oleh Keraguan',
        arabicMatan: 'الْأَصْلُ بَرَاءَةُ الذِّمَّةِ',
        paragraphs: [
          'Termasuk cabang kaidah keyakinan adalah prinsip "Al-Ashlu Bara’atudz Dzimmah" — pada asalnya setiap manusia bebas dari tanggungan utang maupun tuntutan hukum sampai ada bukti sah yang menetapkan sebaliknya.',
          'Prinsip ini menjaga keadilan sosial agar tidak seorang pun dapat dibebani kewajiban finansial atau tuduhan hanya berdasarkan prasangka tanpa bayyinah (alat bukti yang terang).'
        ]
      },
      {
        pageNumber: 5,
        chapterTitle: 'Kaidah III · Kesulitan Mendatangkan Kemudahan',
        arabicMatan: 'الْمَشَقَّةُ تَجْلِبُ التَّيْسِيرَ',
        paragraphs: [
          'Syariat dan kebijaksanaan hukum tidak pernah diturunkan untuk mempersulit hidup manusia di luar batas kesanggupannya. Ketika muncul kondisi darurat atau kesulitan yang melampaui batas kewajaran (masyaqqah ghairu mu’tadah), maka pintu keringanan (rukhshah) dibuka.',
          'Di antara sebab-sebab yang melahirkan keringanan hukum adalah perjalanan jauh (safar), sakit, keterpaksaan, lupa, ketidaktahuan, serta kesulitan umum yang sulit dihindari (umumul balwa).'
        ]
      },
      {
        pageNumber: 6,
        chapterTitle: 'Kaidah III · Kesulitan Mendatangkan Kemudahan',
        arabicMatan: 'إِذَا ضَاقَ الْأَمْرُ اتَّسَعَ، وَإِذَا اتَّسَعَ ضَاقَ.',
        paragraphs: [
          'Imam Asy-Syafi’i merumuskan keseimbangan kaidah ini dalam kalimat yang sangat indah: "Apabila suatu urusan menjadi sempit (karena uzur), maka hukumnya menjadi lapang; dan apabila keadaan telah kembali lapang, maka hukumnya kembali kepada batas asalnya."',
          'Keringanan karena kondisi darurat selalu diukur sesuai kadar kebutuhannya (Adh-Dharuratu Tuqaddaru Biqadariha), sehingga kemudahan tidak disalahgunakan untuk menggugurkan kewajiban secara serampangan.'
        ],
        footnote: 'Rujukan: Al-Asybah wan Nazhair, karya Imam Jalaluddin As-Suyuthi.'
      }
    ]
  },
  {
    id: 'hikam-tazkiyah-03',
    catalogNumber: 'TK-2026.03',
    title: 'Muqaddimah Falsafah Akhlak & Tazkiyatun Nafs',
    subtitle: 'Renungan Penjernihan Batin, Ketenangan Jiwa, dan Adab Pergaulan',
    author: 'Ibnu Atha’illah & Syarah Klasik',
    category: 'Tasawuf & Akhlak',
    language: 'Indonesia · Arab',
    totalPages: 6,
    lastReadPage: 1,
    bookmarks: [],
    addedAt: '02 Oktober 2026',
    isUploadedPdf: false,
    fileSizeLabel: 'Naskah Digital (840 KB)',
    coverTone: 'forest',
    chapters: [
      { id: 'hk-1', number: '01', title: 'Bersandar pada Rahmat, Bukan Semata Amal', startPage: 1 },
      { id: 'hk-2', number: '02', title: 'Cahaya Hati & Ketenangan Batin', startPage: 3 },
      { id: 'hk-3', number: '03', title: 'Adab Menyikapi Ujian & Waktu', startPage: 5 },
    ],
    pages: [
      {
        pageNumber: 1,
        chapterTitle: 'Fasal I · Bersandar pada Rahmat, Bukan Semata Amal',
        arabicMatan: 'مِنْ عَلَامَاتِ الِاعْتِمَادِ عَلَى الْعَمَلِ، نُقْصَانُ الرَّجَاءِ عِنْدَ وُجُودِ الزَّلَلِ.',
        paragraphs: [
          'Di antara tanda bahwa seseorang masih bersandar pada amal perbuatannya sendiri adalah berkurangnya harapan kepada Tuhan tatkala ia tergelincir melakukan kesalahan.',
          'Seorang penempuh jalan kebijaksanaan beramal dengan sungguh-sungguh sebagai bentuk pengabdian, namun hatinya tidak pernah menuhankan amalnya sendiri. Apabila ia berhasil melakukan kebaikan, ia sadar itu semata-mata karunia taufik; dan apabila ia terjatuh dalam kekhilafan, ia segera bangkit dengan taubat tanpa berputus asa.'
        ],
        footnote: 'Hikmah Ke-1 dalam Kitab Al-Hikam karya Syaikh Ibnu Atha’illah As-Sakandari.'
      },
      {
        pageNumber: 2,
        chapterTitle: 'Fasal I · Bersandar pada Rahmat, Bukan Semata Amal',
        arabicMatan: 'ادْفِنْ وُجُودَكَ فِي أَرْضِ الْخُمُولِ، فَمَا نَبَتَ مِمَّا لَمْ يُدْفَنْ لَا يَتِمُّ نَتَاجُهُ.',
        paragraphs: [
          'Tanamlah wujud ketenaran dirimu di dalam tanah kerendahan hati (khumul). Sebab, benih tanaman yang tidak dikubur dengan baik di dalam tanah tidak akan pernah tumbuh menghasilkan buah yang sempurna.',
          'Masa menuntut ilmu dan mematangkan diri adalah masa menanam benih di dalam kesunyian. Terlalu cepat ingin tampil dan dikenal sebelum akarnya menghujam kokoh hanya akan membuat pohon keilmuan mudah tumbang diterpa angin pujian maupun celaan.'
        ]
      },
      {
        pageNumber: 3,
        chapterTitle: 'Fasal II · Cahaya Hati & Ketenangan Batin',
        arabicMatan: 'النُّورُ جُنْدُ الْقَلْبِ كَمَا أَنَّ الظُّلْمَةَ جُنْدُ النَّفْسِ.',
        paragraphs: [
          'Cahaya hikmah adalah bala tentara bagi hati nurani, sebagaimana kegelapan syahwat dan keraguan adalah bala tentara bagi hawa nafsu. Apabila Tuhan hendak menolong seorang hamba-Nya, Dia membekali hati hamba tersebut dengan cahaya bashirah (ketajaman mata batin).',
          'Dengan mata batin yang jernih, seseorang sanggup membedakan mana kebenaran yang sejati dan mana kepalsuan yang berhias indah.'
        ]
      },
      {
        pageNumber: 4,
        chapterTitle: 'Fasal II · Cahaya Hati & Ketenangan Batin',
        paragraphs: [
          'Ketenangan batin (thuma’ninah) tidak diperoleh dari berlimpahnya fasilitas lahiriah, melainkan dari selarasnya kehendak diri dengan ketetapan takdir yang sedang berjalan.',
          'Luangkanlah waktu setiap hari untuk duduk hening bersama kitab-kitab kebijaksanaan, menjauh sejenak dari hiruk-pikuk kabar dunia yang memecah konsentrasi pikiran.'
        ]
      },
      {
        pageNumber: 5,
        chapterTitle: 'Fasal III · Adab Menyikapi Ujian & Waktu',
        arabicMatan: 'حُقُوقٌ فِي الْأَوْقَاتِ يُمْكِنُ قَضَاؤُهَا، وَحُقُوقُ الْأَوْقَاتِ لَا يُمْكِنُ قَضَاؤُهَا.',
        paragraphs: [
          'Kewajiban-kewajiban yang tertinggal di dalam suatu waktu masih mungkin untuk diganti (diqadha) di waktu lain, namun hilangnya keberkahan waktu itu sendiri tidak akan pernah bisa diganti selamanya.',
          'Karena setiap hembusan napas yang berlalu membawa serta kesempatan unik yang tidak berulang dua kali.'
        ]
      },
      {
        pageNumber: 6,
        chapterTitle: 'Fasal III · Adab Menyikapi Ujian & Waktu',
        paragraphs: [
          'Janganlah menunda amal kebaikan dan telaah ilmu hingga engkau merasa benar-benar luang. Sebab, menanti waktu luang yang sempurna di tengah kesibukan dunia adalah salah satu bentuk tipu daya angan-angan (thulul amal).',
          'Ambillah bagian waktumu hari ini, sekecil apa pun, untuk menyalakan pelita ilmu di dalam ruang pribadimu.'
        ]
      }
    ]
  }
];

export const DEFAULT_NOTES: HasyiyahNote[] = [
  {
    id: 'note-default-1',
    kitabId: 'tang-ketab-induk-01',
    pageNumber: 1,
    category: 'syarah',
    quotedText: 'Ilmu bukanlah sekadar tumpukan riwayat yang dihafal di luar kepala',
    content: 'Ungkapan ini merujuk pada perkataan Imam Malik bin Anas: "Al-‘ilmu laisa bikatsratir riwayah, walakinnal ‘ilma nurun yaj‘aluhullahu fil qalb" (Ilmu bukanlah banyaknya riwayat, melainkan cahaya yang diletakkan Allah di dalam hati).',
    createdAt: '14 Okt 2026 · 08:15'
  },
  {
    id: 'note-default-2',
    kitabId: 'tang-ketab-induk-01',
    pageNumber: 3,
    category: 'makna',
    quotedText: 'tashawwur ‘amm',
    content: 'Tashawwur ‘Amm: Gambaran menyeluruh atau peta konsep awal sebelum seseorang mendalami rincian dalil dan perdebatan di setiap sub-bab.',
    createdAt: '14 Okt 2026 · 09:40'
  },
  {
    id: 'note-default-3',
    kitabId: 'risalah-qawaid-02',
    pageNumber: 1,
    category: 'dalil',
    quotedText: 'Al-Umuru Bi Maqashidiha',
    content: 'Disarikan dari hadits masyhur riwayat Umar bin Khattab radhiyallahu ‘anhu: "Innamal a’malu bin-niyyat, wa innama likulli imri’in ma nawa." (HR. Bukhari No. 1 & Muslim No. 1907).',
    createdAt: '10 Okt 2026 · 20:10'
  }
];
