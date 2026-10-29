/**
 * SERENITY SPA & WELLNESS — MULTI-PAGE SPA ROUTER & LOGIC (VANILLA JS ES6+)
 * Hệ thống điều hướng Hash Routing:
 * - #/              : Trang Chủ (Home)
 * - #/services      : Danh Mục Liệu Trình (Services Catalog có Search/Filter/Sort/Pagination)
 * - #/packages      : Cửa hàng dịch vụ gồm liệu trình và gói trị liệu
 * - #/services/:id  : Chi Tiết Liệu Trình Độc Lập (Service Detail + Variant Picker)
 * - #/booking       : Trang Đặt Lịch Chuyên Sâu (Booking Wizard 4 bước + Conflict Check)
 * - #/about         : Giới Thiệu & Triết Lý (About Us)
 * - #/contact       : Liên Hệ & Bản Đồ (Contact Us + LocalStorage persistence)
 * - #/my-bookings   : Lịch Hẹn Của Tôi (Customer Portal + Reviews & Favorites)
 * - #/staff         : Bảng Làm Việc Chuyên Viên (Staff Portal)
 * - #/admin         : Bảng Quản Trị & Thống Kê (Admin Portal CRUD + Canvas Chart)
 * - #/login, #/register : Đăng Nhập & Đăng Ký (Demo 1-Click Accounts)
 */

import { IMAGE_MANIFEST, getImageById, getServiceImage } from './imageManifest.js';
import { ADDITIONAL_THERAPY_SEEDS } from './data/servicesSeed.js';
import { apiClient } from './services/apiClient.js';
import { authService } from './services/authService.js';
import { contactService } from './services/socialAndAnalyticsService.js';
import { on } from './core/events.js';
import { showToast, openServiceModal } from './ui/components.js';
import { initChatbot } from './ui/chatbotLauncher.js';
import { getDisplayPricing, salePriceMarkup } from './ui/salePrice.js';
import { esc } from './core/utils.js';

import { renderServicesPage } from './pages/servicesPage.js';
import { renderServiceDetailPage } from './pages/serviceDetailPage.js';
import { renderBookingPage } from './pages/bookingPage.js';
import { renderMyBookingsPage } from './pages/myBookingsPage.js';
import { renderStaffDashboardPage } from './pages/staffDashboardPage.js';
import { renderAdminDashboardPage } from './pages/adminDashboardPage.js';
import { renderAuthPage } from './pages/authPage.js';
import { renderStaffInvitePage } from './pages/staffInvitePage.js';
import { renderPromotionPage } from './pages/promotionPage.js';

const SERENITY_ADDRESS = '285B Đường Hoàng Sa, Phường Tân Định, Quận 1, TP. Hồ Chí Minh';
const SERENITY_MAP_QUERY = encodeURIComponent(SERENITY_ADDRESS);
const SERENITY_MAP_SEARCH = `https://www.google.com/maps/search/?api=1&query=${SERENITY_MAP_QUERY}`;
const SERENITY_MAP_EMBED = `https://maps.google.com/maps?q=${SERENITY_MAP_QUERY}&z=16&output=embed`;

// DỮ LIỆU DỊCH VỤ & GÓI TRỊ LIỆU (ARRAY OF OBJECTS)
export const SERVICES_DATA = [
  {
    id: 'signature-body',
    name: 'Signature Body Massage',
    category: 'body-massages',
    categoryName: 'Body Massages',
    imageId: 'massage-01',
    duration: 90,
    price: 680000,
    rating: 5.0,
    reviewsCount: 142,
    shortDesc: 'Kỹ thuật độc quyền kết hợp tinh dầu thiên nhiên, đá bazan ấm và kéo giãn cơ nhẹ nhàng giúp giải tỏa căng thẳng toàn diện.',
    fullDesc: 'Signature Body Massage là liệu pháp được yêu thích nhất tại Serenity Spa. Đội ngũ chuyên viên kết hợp nhuần nhuyễn các kỹ thuật miết ấn huyệt sâu, chườm đá nóng năng lượng và tinh dầu nguyên chất nhằm đả thông kinh lạc, phục hồi sinh lực sau chuyến bay dài hoặc những ngày làm việc mệt mỏi.',
    benefits: [
      'Giải phóng hoàn toàn các điểm co thắt cơ bắp vùng lưng và cổ vai gáy',
      'Đá bazan núi lửa giữ nhiệt giúp đào thải độc tố tự nhiên qua hệ bài tiết',
      'Cải thiện tuần hoàn máu và nâng cao chất lượng giấc ngủ sâu',
      'Tặng kèm ngâm chân thảo dược ấm và thưởng trà dưỡng nhan'
    ],
    variants: [
      { duration: 60, price: 490000 },
      { duration: 75, price: 590000 },
      { duration: 90, price: 680000 },
      { duration: 120, price: 880000 }
    ]
  },
  {
    id: 'aroma-therapy',
    name: 'Aroma Massage Tinh Dầu',
    category: 'body-massages',
    categoryName: 'Body Massages',
    imageId: 'aroma-01',
    duration: 75,
    price: 580000,
    rating: 4.9,
    reviewsCount: 98,
    shortDesc: 'Những đường miết êm dịu hòa cùng tinh dầu hoa oải hương và sả chanh nguyên chất giúp xoa dịu hệ thần kinh.',
    fullDesc: 'Trải nghiệm không gian ngát hương thảo mộc thuần khiết. Tinh dầu cao cấp thẩm thấu qua da kết hợp thao tác vuốt dài nhịp nhàng giúp thư giãn tối đa các giác quan và tái tạo làn da mịn màng.',
    benefits: [
      'Giảm căng thẳng tinh thần, xua tan lo âu và mệt mỏi',
      'Cung cấp độ ẩm dồi dào cho làn da với dầu nền hữu cơ',
      'Tạo cảm giác nhẹ nhõm, thanh thản cho toàn bộ cơ thể'
    ],
    variants: [
      { duration: 60, price: 450000 },
      { duration: 75, price: 580000 },
      { duration: 90, price: 660000 }
    ]
  },
  {
    id: 'hot-stone',
    name: 'Hot Stone Therapy',
    category: 'body-massages',
    categoryName: 'Body Massages',
    imageId: 'massage-02',
    duration: 90,
    price: 690000,
    rating: 4.9,
    reviewsCount: 115,
    shortDesc: 'Đá nóng núi lửa hấp giữ nhiệt lý tưởng, trượt sâu vào các thớ cơ giúp giải tỏa các bó cơ xơ cứng.',
    fullDesc: 'Năng lượng nhiệt từ những viên đá bazan đen tự nhiên được hấp nóng chuẩn mực, đặt nhẹ lên các trung tâm năng lượng của cơ thể giúp làm ấm cơ, kích thích lưu thông khí huyết và làm dịu cơn đau nhức cột sống.',
    benefits: [
      'Làm ấm cơ thể, đặc biệt hiệu quả trong thời tiết ẩm hoặc cho người hay lạnh tay chân',
      'Làm mềm các thớ cơ sâu mà không gây đau buốt',
      'Hỗ trợ đào thải độc tố và tăng cường hệ miễn dịch'
    ],
    variants: [
      { duration: 75, price: 590000 },
      { duration: 90, price: 690000 },
      { duration: 120, price: 890000 }
    ]
  },
  {
    id: 'shiatsu-massage',
    name: 'Shiatsu Acupressure Massage',
    category: 'body-massages',
    categoryName: 'Body Massages',
    imageId: 'shiatsu-01',
    duration: 60,
    price: 520000,
    rating: 4.8,
    reviewsCount: 84,
    shortDesc: 'Liệu pháp bấm huyệt truyền thống Nhật Bản, sử dụng lực ngón tay và lòng bàn tay chuẩn xác không dùng dầu.',
    fullDesc: 'Kỹ thuật viên sử dụng lực bấm nhịp nhàng từ ngón cái và lòng bàn tay tác động chính xác vào các huyệt đạo trọng yếu, giúp giải phóng năng lượng ứ trệ và lập lại trạng thái cân bằng tự nhiên cho cơ thể.',
    benefits: [
      'Phù hợp với khách hàng không thích cảm giác bết dính của dầu massage',
      'Đặc trị các điểm co cứng cơ bắp mãn tính',
      'Khôi phục năng lượng tràn đầy ngay sau liệu trình'
    ],
    variants: [
      { duration: 60, price: 520000 },
      { duration: 90, price: 720000 }
    ]
  },
  {
    id: 'thai-massage',
    name: 'Traditional Thai Massage',
    category: 'body-massages',
    categoryName: 'Body Massages',
    imageId: 'thai-01',
    duration: 75,
    price: 590000,
    rating: 4.9,
    reviewsCount: 104,
    shortDesc: 'Phương pháp xoa bóp kéo giãn cơ bắp cổ truyền Thái Lan trên đệm êm, tăng cường sự dẻo dai khớp xương.',
    fullDesc: 'Thực hiện trên nệm rộng êm ái với trang phục thoải mái. Kỹ thuật viên ứng dụng các động tác duỗi cơ Yoga thụ động và bấm huyệt dọc đường kinh Sen giúp mở rộng tầm vận động cơ thể.',
    benefits: [
      'Tăng độ linh hoạt và đàn hồi cho gân cơ, khớp xương',
      'Giải tỏa tình trạng căng cứng sau thời gian dài ngồi máy bay hoặc làm việc',
      'Mang lại tinh thần sảng khoái và tràn đầy sinh lực'
    ],
    variants: [
      { duration: 60, price: 490000 },
      { duration: 75, price: 590000 },
      { duration: 90, price: 690000 }
    ]
  },
  {
    id: 'four-hands',
    name: 'Four Hands Synchronized Massage',
    category: 'body-massages',
    categoryName: 'Body Massages',
    imageId: 'fourhands-01',
    duration: 60,
    price: 890000,
    rating: 5.0,
    reviewsCount: 62,
    shortDesc: 'Hai kỹ thuật viên trị liệu cùng phối hợp nhịp nhàng đồng bộ, mang lại trải nghiệm thư giãn thăng hoa tuyệt đối.',
    fullDesc: 'Đỉnh cao của nghệ thuật massage. Hai đôi bàn tay điêu luyện di chuyển đối xứng và đồng nhịp trên cơ thể khiến tâm trí bạn buông bỏ hoàn toàn sự kiểm soát để đắm chìm vào cảm giác bay bổng thư thái.',
    benefits: [
      'Tác động kép giải tỏa cơ bắp nhanh gấp đôi liệu trình thông thường',
      'Trải nghiệm sang trọng và độc đáo hiếm nơi nào có được',
      'Đem lại trạng thái thư giãn sâu (Deep Zen)'
    ],
    variants: [
      { duration: 60, price: 890000 },
      { duration: 90, price: 1190000 }
    ]
  },
  {
    id: 'foot-head-neck',
    name: 'Foot, Head, Neck & Shoulders',
    category: 'focus-therapy',
    categoryName: 'Focus Therapy',
    imageId: 'foot-01',
    duration: 75,
    price: 550000,
    rating: 5.0,
    reviewsCount: 167,
    shortDesc: 'Sự kết hợp hoàn hảo chăm sóc đôi chân mỏi sau ngày dài đi bộ cùng vùng đầu cổ vai gáy nhức mỏi.',
    fullDesc: 'Dành riêng cho du khách khám phá TP.HCM hoặc nhân viên văn phòng. Liệu trình tập trung vào bấm huyệt phản xạ lòng bàn chân, xoa dịu bắp chân và giải phóng áp lực tích tụ tại vùng cổ vai gáy.',
    benefits: [
      'Giảm đau nhức bàn chân và sưng phù mắt cá tức thì',
      'Đả thông vùng gáy, giảm đau đầu và căng thẳng',
      'Thời lượng vừa vặn, hiệu quả phục hồi nhanh chóng'
    ],
    variants: [
      { duration: 60, price: 460000 },
      { duration: 75, price: 550000 },
      { duration: 90, price: 650000 }
    ]
  },
  {
    id: 'foot-back-neck',
    name: 'Foot, Back, Neck & Shoulders',
    category: 'focus-therapy',
    categoryName: 'Focus Therapy',
    imageId: 'back-massage-01',
    duration: 60,
    price: 480000,
    rating: 4.9,
    reviewsCount: 135,
    shortDesc: 'Xoa dịu tức thì các vùng chịu áp lực nhiều nhất trên cơ thể: đôi chân, thắt lưng và cổ vai gáy.',
    fullDesc: 'Liệu trình bấm huyệt chuyên sâu kết hợp chườm nóng thảo mộc lên vùng lưng dưới và cổ vai giúp hồi sinh thể trạng.',
    benefits: [
      'Đặc trị nhức mỏi vùng thắt lưng do ngồi lâu',
      'Kích hoạt huyệt vị lòng bàn chân cải thiện giấc ngủ',
      'Xoa dịu căng thẳng thần kinh'
    ],
    variants: [
      { duration: 60, price: 480000 },
      { duration: 80, price: 580000 }
    ]
  },
  {
    id: 'belly-massage',
    name: 'Belly Massage Trị Liệu & Tiêu Hóa',
    category: 'focus-therapy',
    categoryName: 'Focus Therapy',
    imageId: 'belly-01',
    duration: 45,
    price: 420000,
    rating: 4.8,
    reviewsCount: 52,
    shortDesc: 'Kỹ thuật massage xoay tròn theo chiều kim đồng hồ quanh ổ bụng với tinh dầu gừng ấm kích thích tiêu hóa.',
    fullDesc: 'Liệu pháp nhẹ nhàng giúp kích thích nhu động ruột, giảm đầy hơi khó tiêu, săn chắc cơ bụng và hỗ trợ đào thải độc tố vùng nội tạng.',
    benefits: [
      'Hỗ trợ tiêu hóa êm ái, giảm chướng bụng đầy hơi',
      'Làm ấm vùng bụng dưới và tăng cường tuần hoàn máu',
      'Thư giãn cơ hoành giúp thở sâu hơn'
    ],
    variants: [
      { duration: 45, price: 420000 },
      { duration: 60, price: 520000 }
    ]
  },
  {
    id: 'herbal-hair-wash',
    name: 'Gội Đầu Dưỡng Sinh Thảo Dược',
    category: 'hair-spa',
    categoryName: 'Others & Hair Wash',
    imageId: 'hair-01',
    duration: 60,
    price: 350000,
    rating: 4.9,
    reviewsCount: 210,
    shortDesc: 'Nước thảo mộc bồ kết, hương nhu sả chanh nấu tươi mỗi ngày, kết hợp massage bấm huyệt đầu cổ chuyên sâu.',
    fullDesc: 'Liệu trình gội đầu dưỡng sinh chuẩn Việt Nam cổ truyền. Làm sạch da đầu bằng thảo dược tự nhiên dịu nhẹ, kết hợp kỹ thuật ấn huyệt đỉnh đầu, thái dương và vuốt thông kinh lạc vùng cổ vai.',
    benefits: [
      'Giúp da đầu sạch thoáng, sợi tóc chắc khỏe bóng mượt tự nhiên',
      'Kích thích lưu thông máu lên não, chấm dứt tình trạng đau nửa đầu',
      'Mang lại giấc ngủ ngon và cảm giác sảng khoái nhẹ nhõm'
    ],
    variants: [
      { duration: 60, price: 350000 },
      { duration: 80, price: 460000 }
    ]
  },
  {
    id: 'cupping-aroma',
    name: 'Cupping Aroma Therapy (Giác Hơi)',
    category: 'hair-spa',
    categoryName: 'Others & Hair Wash',
    imageId: 'facial-02',
    duration: 60,
    price: 480000,
    rating: 4.8,
    reviewsCount: 77,
    shortDesc: 'Liệu pháp giác hơi chân không an toàn kết hợp massage tinh dầu thảo dược giúp trục hàn, giảm đau nhức cơ bắp sâu.',
    fullDesc: 'Ứng dụng phương pháp Đông y kết hợp cốc giác hơi chân không hiện đại giúp tăng cường tuần hoàn máu cục bộ, giải phóng khí trệ và làm mềm các bó cơ thắt chặt.',
    benefits: [
      'Trục khí lạnh, giảm cảm giác nặng nề ở lưng và vai',
      'Hỗ trợ hồi phục thể lực nhanh chóng',
      'Kích thích lưu thông bạch huyết'
    ],
    variants: [
      { duration: 60, price: 480000 }
    ]
  },
  {
    id: 'body-scrub-bath',
    name: 'Tẩy Tế Bào Chết Muối Hồng Himalayan',
    category: 'hair-spa',
    categoryName: 'Others & Hair Wash',
    imageId: 'body-01',
    duration: 60,
    price: 490000,
    rating: 4.8,
    reviewsCount: 65,
    shortDesc: 'Khoáng chất muối hồng Himalayan nguyên chất kết hợp tinh dầu dừa nuôi dưỡng làn da sáng khỏe mịn màng.',
    fullDesc: 'Lấy đi lớp tế bào sừng già cỗi trên bề mặt da một cách dịu nhẹ, bổ sung hơn 84 loại khoáng chất quý và kết thúc bằng bồn tắm thảo dược hoa tươi thanh tịnh.',
    benefits: [
      'Làn da sáng mịn, đều màu và mềm mượt ngay sau 1 lần tẩy',
      'Thúc đẩy quá trình tái tạo collagen tự nhiên dưới da',
      'Thư thái ngâm mình riêng tư tĩnh lặng'
    ],
    variants: [
      { duration: 60, price: 490000 }
    ]
  },
  {
    id: 'facial-dermalogica',
    name: 'Facial Massage & Care with Dermalogica',
    category: 'hair-spa',
    categoryName: 'Others & Hair Wash',
    imageId: 'facial-01',
    duration: 75,
    price: 690000,
    rating: 4.9,
    reviewsCount: 88,
    shortDesc: 'Quy trình chăm sóc và trẻ hóa làn da cao cấp sử dụng 100% dược mỹ phẩm Dermalogica Hoa Kỳ.',
    fullDesc: 'Bao gồm các bước làm sạch sâu, tẩy da chết enzym, massage nâng cơ chống lão hóa, đắp mặt nạ dưỡng ẩm chuyên sâu và bảo vệ da bằng serum dưỡng chất.',
    benefits: [
      'Cấp ẩm tức thì, phục hồi da cháy nắng và mệt mỏi do di chuyển',
      'Nâng cơ mặt và làm mờ các nếp nhăn li ti',
      'Làn da tươi sáng rạng rỡ đầy sức sống'
    ],
    variants: [
      { duration: 60, price: 590000 },
      { duration: 75, price: 690000 }
    ]
  },
  {
    id: 'melt-away-journey',
    name: 'The Melt Away Journey Package',
    category: 'packages',
    categoryName: 'Spa Packages',
    imageId: 'pkg-01',
    duration: 120,
    price: 990000,
    rating: 5.0,
    reviewsCount: 78,
    shortDesc: 'Gói trị liệu trọn gói 120 phút: Ngâm chân hoa tươi + Massage đá nóng toàn thân + Gội đầu dưỡng sinh thảo dược.',
    fullDesc: 'Chuyến hành trình phục hồi đỉnh cao giúp rũ bỏ mọi mệt mỏi. Bạn sẽ được tận hưởng trọn vẹn từ đôi chân, toàn bộ cơ thể cho đến vùng đầu với những đôi bàn tay trị liệu khéo léo nhất.',
    benefits: [
      'Trải nghiệm trọn vẹn 3 dịch vụ cao cấp nhất với mức giá ưu đãi',
      'Phục hồi năng lượng từ thể chất đến tinh thần',
      'Tặng kèm set trà thảo mộc hoa cúc và bánh hạt dinh dưỡng cao cấp'
    ],
    variants: [
      { duration: 120, price: 990000 },
      { duration: 150, price: 1190000 }
    ]
  },
  {
    id: 'ultimate-relax',
    name: 'The Ultimate Relax & Refresh',
    category: 'packages',
    categoryName: 'Spa Packages',
    imageId: 'pkg-02',
    duration: 150,
    price: 1190000,
    rating: 5.0,
    reviewsCount: 92,
    shortDesc: 'Gói chăm sóc thượng hạng 150 phút: Tẩy tế bào chết toàn thân + Massage Body 4 Hands + Chăm sóc da mặt chuyên sâu.',
    fullDesc: 'Gói đặc quyền được thiết kế cho khách hàng muốn dành trọn nửa ngày thư giãn tuyệt đối. Làn da được làm mới hoàn toàn, cơ thể được thả lỏng dưới bàn tay 4 kỹ thuật viên và khuôn mặt bừng sáng rạng ngời.',
    benefits: [
      'Liệu trình toàn diện từ đầu đến chân chuẩn 5 sao',
      'Phòng VIP riêng tư với bồn ngâm hoa tươi',
      'Phục vụ thức uống dưỡng nhan và đồ ăn nhẹ miễn phí'
    ],
    variants: [
      { duration: 150, price: 1190000 },
      { duration: 180, price: 1390000 }
    ]
  },
  {
    id: 'moc-tam-duong-sinh', kind: 'package', components: ['signature-body', 'herbal-hair-wash'],
    name: 'Mộc Tâm & Dưỡng Sinh', category: 'packages', categoryName: 'Spa Packages', imageId: 'pkg-moc-tam-01',
    duration: 150, price: 920000, rating: 0, reviewsCount: 0,
    shortDesc: 'Massage toàn thân kết hợp gội đầu dưỡng sinh thảo dược trong gói 150 phút.',
    fullDesc: 'Kết hợp Signature Body Massage với gội đầu dưỡng sinh thảo dược trong một lịch hẹn liên tục.',
    benefits: ['Kết hợp chăm sóc cơ thể và da đầu', 'Hai liệu trình nối tiếp trong một buổi', 'Một lịch liên tục với một chuyên viên'],
    variants: [{ duration: 150, price: 920000 }]
  },
  {
    id: 'lam-moi-tha-long', kind: 'package', components: ['body-scrub-bath', 'aroma-therapy'],
    name: 'Làm Mới & Thả Lỏng', category: 'packages', categoryName: 'Spa Packages', imageId: 'pkg-lam-moi-01',
    duration: 150, price: 990000, rating: 0, reviewsCount: 0,
    shortDesc: 'Tẩy tế bào chết toàn thân kết hợp massage tinh dầu trong gói 150 phút.',
    fullDesc: 'Bắt đầu với liệu trình tẩy tế bào chết muối hồng Himalayan và tiếp nối bằng massage Aroma.',
    benefits: ['Kết hợp chăm sóc da cơ thể và massage tinh dầu', 'Hai liệu trình nối tiếp trong một buổi', 'Một lịch liên tục với một chuyên viên'],
    variants: [{ duration: 150, price: 990000 }]
  },
  {
    id: 'deo-dai-nhe-chan', kind: 'package', components: ['thai-massage', 'foot-head-neck'],
    name: 'Dẻo Dai, Nhẹ Chân', category: 'packages', categoryName: 'Spa Packages', imageId: 'thai-stretch-01',
    duration: 150, price: 990000, rating: 0, reviewsCount: 0,
    shortDesc: 'Massage Thái kết hợp chăm sóc bàn chân, đầu và cổ-vai-gáy trong gói 150 phút.',
    fullDesc: 'Kết hợp các động tác kéo giãn trong massage Thái với liệu trình chăm sóc bàn chân và vùng đầu, cổ, vai.',
    benefits: ['Kết hợp massage toàn thân và chăm sóc các vùng chân, đầu, cổ-vai-gáy', 'Hai liệu trình nối tiếp trong một buổi', 'Một lịch liên tục với một chuyên viên'],
    variants: [{ duration: 150, price: 990000 }]
  },
  {
    id: 'am-da-sang-da', kind: 'package', components: ['hot-stone', 'facial-dermalogica'],
    name: 'Ấm Đá & Sáng Da', category: 'packages', categoryName: 'Spa Packages', imageId: 'pkg-am-da-01',
    duration: 180, price: 1290000, rating: 0, reviewsCount: 0,
    shortDesc: 'Massage đá nóng kết hợp chăm sóc da mặt trong gói 180 phút.',
    fullDesc: 'Kết hợp massage đá nóng với liệu trình chăm sóc da mặt Dermalogica trong một lịch hẹn liên tục.',
    benefits: ['Kết hợp massage đá nóng với chăm sóc da mặt', 'Hai liệu trình nối tiếp trong một buổi', 'Một lịch liên tục với một chuyên viên'],
    variants: [{ duration: 180, price: 1290000 }]
  },
  {
    id: 'goi-thao-moc-cham-da', kind: 'package', components: ['herbal-hair-wash', 'facial-dermalogica'],
    name: 'Gội Thảo Mộc & Chăm Da', category: 'packages', categoryName: 'Spa Packages', imageId: 'pkg-goi-thao-moc-01',
    duration: 135, price: 920000, rating: 0, reviewsCount: 0,
    shortDesc: 'Gội đầu dưỡng sinh thảo dược kết hợp chăm sóc da mặt trong gói 135 phút.',
    fullDesc: 'Kết hợp gội đầu dưỡng sinh thảo dược với liệu trình chăm sóc da mặt Dermalogica trong một lịch hẹn liên tục.',
    benefits: ['Kết hợp chăm sóc da đầu thảo dược và da mặt', 'Hai liệu trình nối tiếp trong một buổi', 'Một lịch liên tục với một chuyên viên'],
    variants: [{ duration: 135, price: 920000 }]
  },
  ...ADDITIONAL_THERAPY_SEEDS,
];

// CHUYÊN VIÊN TRỊ LIỆU DEMO
export const STAFF_DATA = [
  { id: 'st-01', name: 'Mai Linh', title: 'Senior Therapist • 7 năm kinh nghiệm', imageId: 'staff-01' },
  { id: 'st-02', name: 'Thu Trang', title: 'Skin & Facial Specialist • Chăm sóc da', imageId: 'staff-02' },
  { id: 'st-03', name: 'Khánh Vy', title: 'Aroma & Hair Spa Master • Dưỡng sinh', imageId: 'staff-03' },
  { id: 'st-04', name: 'Hoàng Nam', title: 'Shiatsu & Deep Tissue Specialist', imageId: 'staff-04' }
];

export function formatVND(amount) {
  return new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(amount);
}

// KHỞI ĐỘNG HỆ THỐNG ĐIỀU HƯỚNG
document.addEventListener('DOMContentLoaded', () => {
  const appRoot = document.getElementById('appRoot');
  if (appRoot) appRoot.innerHTML = '<div class="section-container" style="padding:100px 20px;text-align:center;">Đang kết nối dữ liệu Serenity…</div>';
  apiClient.initialize().then((sharedBackend) => {
    if (!sharedBackend) {
      if (appRoot) appRoot.innerHTML = `
        <section class="section-container" style="max-width:680px;padding:90px 20px;text-align:center;">
          <h2 style="font-family:var(--font-heading);color:var(--text-dark);">Chưa kết nối được máy chủ</h2>
          <p style="color:var(--text-light);line-height:1.7;">Dữ liệu Serenity được lưu tập trung. Hãy chạy <code>npm start</code> trong thư mục project để mở hệ thống tại cổng 3001, rồi thử lại.</p>
          <button type="button" class="btn-primary" id="retryServerBtn">Thử kết nối lại</button>
        </section>`;
      document.getElementById('retryServerBtn')?.addEventListener('click', () => window.location.reload());
      return;
    }
    initNavbar();
    initModalListeners();
    on('auth:login', () => updateActiveNav(window.location.hash || '#/'));
    on('auth:logout', () => updateActiveNav(window.location.hash || '#/'));
    on('data:changed', ({ source }) => {
      if (source !== 'remote') return;
      updateActiveNav(window.location.hash || '#/');
      if (document.querySelector('.spa-agent-panel') || document.querySelector('#serviceModal.show')) return;
      const active = document.activeElement;
      if (active?.matches?.('input, textarea, select')) return;
      const scrollY = window.scrollY;
      handleRoute();
      requestAnimationFrame(() => window.scrollTo({ top: scrollY, behavior: 'auto' }));
    });
    window.addEventListener('hashchange', handleRoute);
    initChatbot();
    handleRoute();
  });
});

function initModalListeners() {
  const modal = document.getElementById('serviceModal');
  if (modal) {
    const syncVisibility = () => modal.setAttribute('aria-hidden', String(!modal.classList.contains('show')));
    syncVisibility();
    new MutationObserver(syncVisibility).observe(modal, { attributes: true, attributeFilter: ['class'] });
  }
  document.getElementById('closeModalBtn')?.addEventListener('click', () => {
    document.getElementById('serviceModal')?.classList.remove('show');
  });
  document.getElementById('serviceModal')?.addEventListener('click', (e) => {
    if (e.target.id === 'serviceModal') {
      e.target.classList.remove('show');
    }
  });
}

/* ==========================================================================
   ROUTER XỬ LÝ ĐIỀU HƯỚNG THEO URL HASH
   ========================================================================== */
function handleRoute() {
  const hash = window.location.hash || '#/';
  const route = hash.split('?')[0];
  const appRoot = document.getElementById('appRoot');
  if (!appRoot) return;

  // Cập nhật trạng thái active và danh sách liên kết trên navbar theo vai trò
  updateActiveNav(hash);

  // Cuộn lên đầu trang khi chuyển view
  window.scrollTo({ top: 0, behavior: 'smooth' });

  // Route: Kích hoạt tài khoản nhân viên từ lời mời admin.
  if (hash.startsWith('#/staff-invite')) {
    const urlParams = new URLSearchParams(hash.split('?')[1] || '');
    renderStaffInvitePage(urlParams.get('token') || '');
    return;
  }

  // Route: Chi tiết dịch vụ #/services/:id
  if (hash.startsWith('#/services/')) {
    const serviceId = hash.replace('#/services/', '').trim();
    renderServiceDetailPage(serviceId);
    return;
  }

  const promotionPageRoute = route.match(/^#\/pages\/([a-z0-9-]+)$/i);
  if (promotionPageRoute) {
    renderPromotionPage(promotionPageRoute[1]);
    return;
  }

  // Route: Đặt lịch có chọn trước dịch vụ #/booking?service=:id&duration=:dur
  if (hash.startsWith('#/booking')) {
    const urlParams = new URLSearchParams(hash.split('?')[1] || '');
    const preServiceId = urlParams.get('service');
    const preDuration = urlParams.get('duration');
    renderBookingPage(preServiceId, preDuration, {
      date: urlParams.get('date'), time: urlParams.get('time'), staffId: urlParams.get('staff'),
    });
    return;
  }

  if (hash === '#/login' || hash.startsWith('#/login?') || hash === '#/register' || hash.startsWith('#/register?')) {
    const isRegister = hash.startsWith('#/register');
    const urlParams = new URLSearchParams(hash.split('?')[1] || '');
    const returnTo = urlParams.get('returnTo') === 'booking' ? 'booking' : null;
    renderAuthPage(isRegister ? 'register' : 'login', returnTo);
    return;
  }

  // Các Route độc lập
  switch (route) {
    case '#/':
    case '#/home':
      renderHomePage();
      break;
    case '#/services':
      renderServicesPage('all');
      break;
    case '#/packages':
      renderServicesPage('packages', new URLSearchParams(hash.split('?')[1] || '').get('date'));
      break;
    case '#/about':
      renderAboutPage();
      break;
    case '#/contact':
      renderContactPage();
      break;
    case '#/my-bookings':
      renderMyBookingsPage();
      break;
    case '#/staff':
      renderStaffDashboardPage();
      break;
    case '#/admin':
      renderAdminDashboardPage();
      break;
    default:
      renderHomePage();
      break;
  }
}

function updateActiveNav(hash) {
  const user = authService.getCurrentUser();
  const menubarUl = document.querySelector('.menubar ul');
  const route = hash.split('?')[0];
  const siteMenu = apiClient.getSiteContent().menuItems.filter((item) => item.targetHref);
  const routeOverrides = new Map(siteMenu.filter((item) => item.targetType === 'route').map((item) => [item.routeKey, item]));
  const link = (key, label, href) => {
    const override = routeOverrides.get(key);
    if (override && !override.enabled) return '';
    const target = override?.targetHref || href;
    return `<li><a href="${esc(target)}" class="${route === target.split('?')[0] ? 'active' : ''}">${esc(override?.label || label)}</a></li>`;
  };

  // Cập nhật các menu theo vai trò người dùng
  if (menubarUl) {
    let extraNavs = '';
    if (user?.role === 'staff') {
      extraNavs = `<li><a href="#/staff" class="${hash === '#/staff' ? 'active' : ''}">Staff Portal</a></li>`;
    } else if (user?.role === 'admin') {
      extraNavs = `<li><a href="#/admin" class="${hash === '#/admin' ? 'active' : ''}">Quản Trị</a></li>`;
    }
    const defaultRouteKeys = new Set(['home', 'services', 'about', 'contact']);
    const managedNavs = siteMenu.filter((item) => item.enabled && (item.targetType === 'page'
      || (item.targetType === 'route' && !defaultRouteKeys.has(item.routeKey))))
      .map((item) => `<li><a href="${esc(item.targetHref)}" class="${route === item.targetHref.split('?')[0] ? 'active' : ''}">${esc(item.label)}</a></li>`).join('');
    menubarUl.innerHTML = `
      ${link('home', 'Trang Chủ', '#/')}
      ${link('services', 'Dịch Vụ', '#/packages')}
      ${link('about', 'Về Chúng Tôi', '#/about')}
      ${link('contact', 'Liên Hệ', '#/contact')}
      <li><a href="#/my-bookings" class="${route === '#/my-bookings' ? 'active' : ''}">Lịch Của Tôi</a></li>
      ${managedNavs}
      ${extraNavs}
      ${user ? `
        <li><a href="#/my-bookings" style="color:var(--primary-brown);font-weight:bold;">👤 ${esc(user.name.split(' ').slice(-1)[0])}</a></li>
      ` : `
        <li><a href="#/login" class="${hash === '#/login' ? 'active' : ''}" style="color:var(--primary-brown);font-weight:bold;">🔑 Đăng Nhập</a></li>
      `}
    `;
  }

  // Đóng mobile menu nếu đang mở
  document.querySelector('.menubar')?.classList.remove('mobile-open');
  const toggleBtn = document.getElementById('mobileMenuBtn');
  toggleBtn?.setAttribute('aria-expanded', 'false');
  toggleBtn?.setAttribute('aria-label', 'Mở menu điều hướng');
}

function initNavbar() {
  const toggleBtn = document.getElementById('mobileMenuBtn');
  const menuBar = document.querySelector('.menubar');
  toggleBtn?.addEventListener('click', () => {
    const isOpen = menuBar?.classList.toggle('mobile-open') || false;
    toggleBtn.setAttribute('aria-expanded', String(isOpen));
    toggleBtn.setAttribute('aria-label', isOpen ? 'Đóng menu điều hướng' : 'Mở menu điều hướng');
  });
}

/* ==========================================================================
   1. TRANG CHỦ (HOME PAGE)
   ========================================================================== */
function renderHomePage() {
  const root = document.getElementById('appRoot');

  root.innerHTML = `
    <!-- Hero Section with 4-Slide Auto Rotating Slider & Vertical Text -->
    <section class="hero">
      <div class="hero-slider" id="heroSlider">
        <div class="slide active" style="background-image: url('assets/images/hero_1.webp');"></div>
        <div class="slide" style="background-image: url('assets/images/hero_2.webp');"></div>
        <div class="slide" style="background-image: url('assets/images/hero_3.webp');"></div>
        <div class="slide" style="background-image: url('assets/images/hero_4.webp');"></div>
      </div>
      <div class="vertical-text">SERENITY SPA &amp; WELLNESS • DISTRICT 1 • SAIGON</div>
      <div class="hero-content">
        <h1>Serenity Spa in <span>District 1</span></h1>
        <p>Massage thư giãn và chăm sóc cơ thể tại 285B Đường Hoàng Sa, Quận 1 — giữa lòng TP. Hồ Chí Minh.</p>
        <div class="hero-buttons">
          <a href="#/booking" class="btn-primary">Đặt Lịch Ngay (Book Now)</a>
          <a href="#/packages" class="btn-outline-white">Khám Phá Dịch Vụ</a>
        </div>
      </div>
    </section>

    <!-- Featured Spa Services (4 Tab Menu + Filtered Cards Grid) -->
    <section class="container" style="background-color: var(--bg-light); max-width: 100%; padding-left: 20px; padding-right: 20px;">
      <div style="max-width: 1240px; margin: 0 auto;">
        <div class="section-title-center">
          <span style="color: var(--primary-brown); font-size: 13px; font-weight: 600; text-transform: uppercase; letter-spacing: 2px;">Thực Đơn Trị Liệu</span>
          <h2 style="margin-top: 5px;">Discover Our Spa Massages</h2>
          <p>Thực đơn trị liệu phong phú được thiết kế chuẩn mực nhằm tái tạo năng lượng và phục hồi thể trạng cho bạn</p>
        </div>

        <!-- 4 Service Category Tabs -->
        <div class="service-tabs" style="display: flex; justify-content: center; gap: 12px; margin-bottom: 40px; flex-wrap: wrap;">
          <button type="button" class="tab-btn active" data-home-cat="body-massages">Body Massages</button>
          <button type="button" class="tab-btn" data-home-cat="focus-therapy">Focus Therapy</button>
          <button type="button" class="tab-btn" data-home-cat="hair-spa">Others &amp; Hair Wash</button>
          <button type="button" class="tab-btn" data-home-cat="packages">Spa Packages</button>
        </div>

        <!-- Dynamic Package Cards Grid -->
        <div class="packages-grid" id="homeServicesGrid">
          ${SERVICES_DATA.filter(s => s.category === 'body-massages').map(s => renderPackageCardHtml(s)).join('')}
        </div>

        <div style="text-align: center; margin-top: 50px;">
          <a href="#/packages" class="btn-outline">Xem Toàn Bộ Thực Đơn &amp; Bảng Giá →</a>
        </div>
      </div>
    </section>

    <!-- Why Choose Serenity / 4 USPs Block (Background #FBF8F1) -->
    <section class="usp-section">
      <div class="container" style="padding-top: 0; padding-bottom: 0;">
        <div class="usp-grid">
          <div class="usp-card">
            <div class="usp-icon">📍</div>
            <h3>Địa Điểm Tại Quận 1</h3>
            <p>Serenity Spa đón khách tại 285B Đường Hoàng Sa, Phường Tân Định, Quận 1, TP. Hồ Chí Minh.</p>
          </div>
          <div class="usp-card">
            <div class="usp-icon">💎</div>
            <h3>Affordable Luxury</h3>
            <p>Trải nghiệm spa nghỉ dưỡng tiêu chuẩn cao cấp với mức giá niêm yết rõ ràng, minh bạch, hoàn toàn không phụ phí.</p>
          </div>
          <div class="usp-card">
            <div class="usp-icon">👐</div>
            <h3>Expert Therapists</h3>
            <p>Đội ngũ kỹ thuật viên giàu kinh nghiệm, chu đáo và giao tiếp tiếng Anh lưu loát, phục vụ chu đáo du khách quốc tế.</p>
          </div>
          <div class="usp-card">
            <div class="usp-icon">🌿</div>
            <h3>Không Gian Thư Giãn</h3>
            <p>Không gian chăm sóc yên tĩnh, giúp bạn tạm rời nhịp sống bận rộn và tập trung nghỉ ngơi.</p>
          </div>
        </div>
      </div>
    </section>

    <!-- Healing Journey 4-Step Procedure -->
    <section class="healing-journey">
      <div class="container" style="padding-top: 0; padding-bottom: 0;">
        <div class="section-title-center" style="margin-bottom: 20px;">
          <span style="color: var(--primary-brown); font-size: 13px; font-weight: 600; text-transform: uppercase; letter-spacing: 2px;">Quy Trình Chuẩn Mực</span>
          <h2 style="margin-top: 5px;">Hành Trình Chữa Lành Thân - Tâm - Trí</h2>
          <p>Quy trình 4 bước chăm sóc tiêu chuẩn mang lại sự thư giãn trọn vẹn nhất cho bạn</p>
        </div>
        <div class="journey-steps">
          <div class="step-item">
            <div class="step-number">01</div>
            <h3>Đón Tiếp &amp; Thưởng Trà</h3>
            <p>Thư giãn tại sảnh ấm cúng, thưởng thức tách trà thảo mộc ấm và ngâm chân hoa tươi thanh lọc cơ thể.</p>
          </div>
          <div class="step-item">
            <div class="step-number">02</div>
            <h3>Tư Vấn Thể Trạng</h3>
            <p>Thăm khám các điểm đau mỏi cơ bắp và chọn loại tinh dầu thảo dược yêu thích phù hợp thể trạng.</p>
          </div>
          <div class="step-item">
            <div class="step-number">03</div>
            <h3>Trị Liệu Chuyên Sâu</h3>
            <p>Tận hưởng kỹ thuật ấn huyệt trượt sâu của chuyên viên kết hợp chườm ấm đá núi lửa hoặc thảo dược.</p>
          </div>
          <div class="step-item">
            <div class="step-number">04</div>
            <h3>Hồi Phục Sinh Lực</h3>
            <p>Tráng nước ấm thơm dịu, thưởng thức bánh hạt dinh dưỡng và trà dưỡng nhan trước khi ra về.</p>
          </div>
        </div>
      </div>
    </section>

    <!-- Serenity Spa Introduction -->
    <section class="container">
      <div class="about-split">
        <div class="about-content">
          <span style="color: var(--primary-brown); font-size: 13px; font-weight: 600; text-transform: uppercase; letter-spacing: 2px;">Về Chúng Tôi</span>
          <h2 style="margin-top: 5px; margin-bottom: 20px;">Welcome to Serenity Spa &amp; Wellness</h2>
          <p>Tọa lạc tại ${SERENITY_ADDRESS}, Serenity Spa cung cấp các liệu trình massage và chăm sóc sức khỏe cho khách hàng tại TP. Hồ Chí Minh.</p>
          <p>Dù bạn ghé thăm để tận hưởng 60 phút massage chân thư giãn sau chuyến đi bộ quanh thành phố hay một buổi chiều trọn vẹn với các gói chăm sóc đặc quyền, chúng tôi luôn cam kết mang lại không khí bình yên, ấm áp như được trở về nhà.</p>
          <ul class="about-checklist">
            <li><span>✓</span> Các liệu trình massage và chăm sóc cơ thể đa dạng</li>
            <li><span>✓</span> Không gian thư giãn, thoải mái</li>
            <li><span>✓</span> Dịch vụ được lựa chọn theo nhu cầu của bạn</li>
          </ul>
          <div style="margin-top: 30px; display: flex; gap: 15px; flex-wrap: wrap;">
            <a href="#/about" class="btn-outline">Khám Phá Về Chúng Tôi</a>
            <a href="#/booking" class="btn-primary">Đặt Lịch Trải Nghiệm</a>
          </div>
        </div>
        <div class="about-img">
          <img src="assets/images/about_welcome.webp" alt="Không gian Serenity Spa" style="width: 100%; border-radius: 8px; box-shadow: 0 15px 35px rgba(0,0,0,0.08);" />
        </div>
      </div>

    </section>

    <!-- Booking Call To Action -->
    <section class="container" style="padding-top: 60px; padding-bottom: 60px;">
      <div class="section-title-center">
        <span style="color: var(--primary-brown); font-size: 13px; font-weight: 600; text-transform: uppercase; letter-spacing: 2px;">Serenity Spa &amp; Wellness</span>
        <h2 style="margin-top: 5px;">Dành Thời Gian Cho Sự Thư Giãn</h2>
        <p>Chọn liệu trình phù hợp với nhu cầu của bạn hoặc gửi lời nhắn để được tư vấn thêm.</p>
        <a href="#/packages" class="btn-outline" style="margin: 10px;">Xem Dịch Vụ</a>
        <a href="#/booking" class="btn-primary" style="margin: 10px;">Đặt Lịch</a>
      </div>
    </section>

    <section class="container" style="padding-top: 0; padding-bottom: 60px;">
      <!-- Google Maps Location for Serenity Spa -->
      <div style="margin-top: 60px; border-radius: 8px; overflow: hidden; box-shadow: 0 10px 30px rgba(0,0,0,0.06);">
        <div style="padding: 16px 20px; background: #fff; border-bottom: 1px solid var(--border-light); display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 10px;">
          <div>
            <strong>📍 Địa chỉ spa:</strong> ${SERENITY_ADDRESS}
          </div>
          <a href="${SERENITY_MAP_SEARCH}" target="_blank" rel="noopener" class="btn-outline" style="padding: 6px 14px; font-size: 11px;">
            Mở Trên Google Maps ↗
          </a>
        </div>
        <iframe
          src="${SERENITY_MAP_EMBED}"
          width="100%"
          height="320"
          style="border:0; display:block;"
          allowfullscreen=""
          loading="lazy"
          referrerpolicy="no-referrer-when-downgrade">
        </iframe>
      </div>
    </section>

    <!-- Our Sanctuary (Continuous Smooth Infinite Marquee Loop) -->
    <section style="padding: 40px 0 20px; background: #fff;">
      <div class="section-title-center" style="margin-bottom: 30px;">
        <span style="color: var(--primary-brown); font-size: 13px; font-weight: 600; text-transform: uppercase; letter-spacing: 2px;">Không Gian Trị Liệu</span>
        <h2 style="margin-top: 5px;">Our Sanctuary</h2>
        <p>Chiêm ngưỡng không gian nghỉ dưỡng thanh lịch, ấm cúng và vô trùng tại trung tâm Quận 1</p>
      </div>

      <div class="marquee-wrapper">
        <div class="marquee-track">
          <!-- Gallery images repeated twice for a seamless loop -->
          <div class="marquee-item"><img src="assets/images/sanctuary_1.webp" alt="Sanctuary 1" /></div>
          <div class="marquee-item"><img src="assets/images/sanctuary_2.webp" alt="Sanctuary 2" /></div>
          <div class="marquee-item"><img src="assets/images/sanctuary_3.webp" alt="Sanctuary 3" /></div>
          <div class="marquee-item"><img src="assets/images/sanctuary_4.webp" alt="Sanctuary 4" /></div>
          <div class="marquee-item"><img src="assets/images/sanctuary_5.webp" alt="Sanctuary 5" /></div>
          <div class="marquee-item"><img src="assets/images/sanctuary_6.webp" alt="Sanctuary 6" /></div>
          <div class="marquee-item"><img src="assets/images/sanctuary_7.webp" alt="Sanctuary 7" /></div>
          <div class="marquee-item"><img src="assets/images/sanctuary_8.webp" alt="Sanctuary 8" /></div>
          <div class="marquee-item"><img src="assets/images/sanctuary_9.webp" alt="Sanctuary 9" /></div>
          <div class="marquee-item"><img src="assets/images/sanctuary_10.webp" alt="Sanctuary 10" /></div>
          <!-- Loop duplicate -->
          <div class="marquee-item"><img src="assets/images/sanctuary_1.webp" alt="Sanctuary 1" /></div>
          <div class="marquee-item"><img src="assets/images/sanctuary_2.webp" alt="Sanctuary 2" /></div>
          <div class="marquee-item"><img src="assets/images/sanctuary_3.webp" alt="Sanctuary 3" /></div>
          <div class="marquee-item"><img src="assets/images/sanctuary_4.webp" alt="Sanctuary 4" /></div>
          <div class="marquee-item"><img src="assets/images/sanctuary_5.webp" alt="Sanctuary 5" /></div>
          <div class="marquee-item"><img src="assets/images/sanctuary_6.webp" alt="Sanctuary 6" /></div>
          <div class="marquee-item"><img src="assets/images/sanctuary_7.webp" alt="Sanctuary 7" /></div>
          <div class="marquee-item"><img src="assets/images/sanctuary_8.webp" alt="Sanctuary 8" /></div>
          <div class="marquee-item"><img src="assets/images/sanctuary_9.webp" alt="Sanctuary 9" /></div>
          <div class="marquee-item"><img src="assets/images/sanctuary_10.webp" alt="Sanctuary 10" /></div>
        </div>
      </div>
    </section>

    <!-- Serenity Spa wellness articles -->
    <section class="container" style="padding-top: 80px; padding-bottom: 80px;">
      <div class="section-title-center">
        <span style="color: var(--primary-brown); font-size: 13px; font-weight: 600; text-transform: uppercase; letter-spacing: 2px;">Cẩm Nang Sức Khỏe</span>
        <h2 style="margin-top: 5px;">Blogs</h2>
        <p>Khám phá kiến thức chăm sóc cơ thể, kinh nghiệm du lịch và những bí quyết thư giãn phục hồi</p>
      </div>

      <div class="blog-grid">
        <div class="blog-card">
          <div class="blog-img">
            <img src="assets/images/blog_1.webp" alt="Massage Price Saigon vs Bangkok vs Bali" />
          </div>
          <div class="blog-info">
            <span class="blog-date">Tháng 6, 2026</span>
            <h3>Massage Price Saigon vs Bangkok vs Bali: What an Hour Costs</h3>
            <p>So sánh chi tiết mức giá và chất lượng dịch vụ massage trị liệu tại 3 thiên đường du lịch Đông Nam Á...</p>
            <a href="#/contact" class="read-more" style="color: var(--primary-brown); font-weight: 600; text-decoration: none;">Đọc Thêm →</a>
          </div>
        </div>

        <div class="blog-card">
          <div class="blog-img">
            <img src="assets/images/blog_2.webp" alt="Massage After a Walking Tour" />
          </div>
          <div class="blog-info">
            <span class="blog-date">Tháng 6, 2026</span>
            <h3>Massage After a Walking Tour: 7 Fixes for Sore Legs</h3>
            <p>7 phương pháp trị liệu thần tốc giúp hồi phục cơ bắp chân mỏi nhừ sau ngày dài đi bộ khám phá phố phường...</p>
            <a href="#/contact" class="read-more" style="color: var(--primary-brown); font-weight: 600; text-decoration: none;">Đọc Thêm →</a>
          </div>
        </div>

        <div class="blog-card">
          <div class="blog-img">
            <img src="assets/images/blog_3.webp" alt="Layover Massage in Ho Chi Minh City" />
          </div>
          <div class="blog-info">
            <span class="blog-date">Tháng 9, 2026</span>
            <h3>Layover Massage in Ho Chi Minh City: A Smart 6-Hour Plan</h3>
            <p>Kế hoạch 6 tiếng nghỉ giữa các chuyến bay: Di chuyển nhanh từ sân bay Tân Sơn Nhất về Quận 1 thư giãn...</p>
            <a href="#/contact" class="read-more" style="color: var(--primary-brown); font-weight: 600; text-decoration: none;">Đọc Thêm →</a>
          </div>
        </div>

        <div class="blog-card">
          <div class="blog-img">
            <img src="assets/images/blog_4.webp" alt="Massage Package in District 1" />
          </div>
          <div class="blog-info">
            <span class="blog-date">Tháng 6, 2026</span>
            <h3>Massage Package in District 1: Which One Fits Your Trip?</h3>
            <p>Hướng dẫn chọn gói spa trị liệu phù hợp nhất với thời gian và lịch trình chuyến du lịch của bạn...</p>
            <a href="#/contact" class="read-more" style="color: var(--primary-brown); font-weight: 600; text-decoration: none;">Đọc Thêm →</a>
          </div>
        </div>

        <div class="blog-card">
          <div class="blog-img">
            <img src="assets/images/blog_5.webp" alt="Herbal Compress Massage in Vietnam" />
          </div>
          <div class="blog-info">
            <span class="blog-date">Tháng 8, 2026</span>
            <h3>Herbal Compress Massage in Vietnam: 7 Things to Know First</h3>
            <p>Những điều cần biết về liệu pháp chườm túi thảo mộc Việt Nam cổ truyền giúp lưu thông khí huyết...</p>
            <a href="#/contact" class="read-more" style="color: var(--primary-brown); font-weight: 600; text-decoration: none;">Đọc Thêm →</a>
          </div>
        </div>

        <div class="blog-card">
          <div class="blog-img">
            <img src="assets/images/blog_6.webp" alt="Best Body Scrub for Your Skin" />
          </div>
          <div class="blog-info">
            <span class="blog-date">Tháng 9, 2026</span>
            <h3>Best Body Scrub for Your Skin: Rice Bran, Coffee or Salt?</h3>
            <p>Phân tích ưu điểm của cám gạo, bã cà phê và muối hồng Himalayan đối với từng loại da...</p>
            <a href="#/contact" class="read-more" style="color: var(--primary-brown); font-weight: 600; text-decoration: none;">Đọc Thêm →</a>
          </div>
        </div>
      </div>
    </section>    <!-- Closing Booking Banner Call To Action Banner -->
    <section class="final-cta" style="background-image: url('assets/images/cta_bg.webp');">
      <div class="container">
        <h2>Ready to Relax?</h2>
        <p>Đặt lịch trước để được chuẩn bị phòng riêng chu đáo và chuyên viên phù hợp nhất mà không phải chờ đợi sau những giờ khám phá Sài Gòn.</p>
        <div class="cta-buttons">
          <a href="#/booking" class="btn-primary">Đặt Lịch Ngay (Book Now)</a>
          <a href="#/contact" class="btn-outline" style="border-color: #fff !important; color: #fff !important;">Liên Hệ Chỉ Đường</a>
        </div>
      </div>
    </section>
  `;

  // Khởi động Hero Slider tự động đổi ảnh nền sau mỗi 5 giây
  initHeroSlider();

  // Khởi động bộ lọc 4 danh mục dịch vụ trên trang chủ
  initHomeServiceTabs();
}

function initHeroSlider() {
  const slides = document.querySelectorAll('#heroSlider .slide');
  if (!slides || slides.length === 0) return;

  let currentIdx = 0;
  // Xóa interval cũ nếu có
  if (window.heroSliderInterval) {
    clearInterval(window.heroSliderInterval);
  }

  window.heroSliderInterval = setInterval(() => {
    slides[currentIdx].classList.remove('active');
    currentIdx = (currentIdx + 1) % slides.length;
    slides[currentIdx].classList.add('active');
  }, 5000);
}

function initHomeServiceTabs() {
  const tabs = document.querySelectorAll('.service-tabs button');
  const grid = document.getElementById('homeServicesGrid');
  if (!tabs || !grid) return;

  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      tabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');

      const cat = tab.getAttribute('data-home-cat');
      const filtered = SERVICES_DATA.filter(s => s.category === cat);
      grid.innerHTML = filtered.map(s => renderPackageCardHtml(s)).join('');
    });
  });
}

/* ==========================================================================
   2. TRANG DANH MỤC DỊCH VỤ (SERVICES CATALOG PAGE)
   ========================================================================== */
function _legacy_renderServicesPage(defaultCat = 'all') {
  const root = document.getElementById('appRoot');

  root.innerHTML = `
    <div class="page-banner">
      <h1>Thực Đơn Trị Liệu &amp; Bảng Giá</h1>
      <p>Khám phá đầy đủ các liệu trình Body Massage, Foot Care, Chăm sóc da và Gói Spa cao cấp.</p>
      <div class="breadcrumbs">
        <a href="#/">Trang Chủ</a> / <span>Dịch Vụ &amp; Gói Trị Liệu</span>
      </div>
    </div>

    <div class="container">
      <!-- Search & Filter Bar -->
      <div class="service-filter-bar">
        <div class="search-box">
          <span>🔍</span>
          <input type="text" id="serviceSearchInput" placeholder="Tìm kiếm liệu trình (massage, đá nóng, gội đầu...)" />
        </div>
        <div style="display: flex; gap: 15px; align-items: center;">
          <label style="font-size: 0.9rem; font-weight: 500; color: var(--text-dark);">Sắp xếp:</label>
          <select id="serviceSortSelect" style="padding: 8px 14px; border: 1px solid var(--border-color); border-radius: 4px; outline: none;">
            <option value="featured">Nổi bật nhất</option>
            <option value="price-asc">Giá: Thấp đến Cao</option>
            <option value="price-desc">Giá: Cao đến Thấp</option>
            <option value="duration">Thời lượng dài nhất</option>
          </select>
        </div>
      </div>

      <!-- Categories Tabs -->
      <div class="service-tabs">
        <button class="tab-btn ${defaultCat === 'all' ? 'active' : ''}" data-cat="all">Tất Cả Liệu Trình</button>
        <button class="tab-btn ${defaultCat === 'body-massages' ? 'active' : ''}" data-cat="body-massages">Body Massages</button>
        <button class="tab-btn ${defaultCat === 'focus-therapy' ? 'active' : ''}" data-cat="focus-therapy">Focus Therapy</button>
        <button class="tab-btn ${defaultCat === 'hair-spa' ? 'active' : ''}" data-cat="hair-spa">Others &amp; Hair Wash</button>
        <button class="tab-btn ${defaultCat === 'packages' ? 'active' : ''}" data-cat="packages">Spa Packages</button>
      </div>

      <!-- Services Grid Container -->
      <div class="packages-grid" id="servicesCatalogGrid">
        <!-- Rendered by JS -->
      </div>
    </div>
  `;

  let currentCategory = defaultCat;
  let currentKeyword = '';
  let currentSort = 'featured';

  const filterAndRender = () => {
    const grid = document.getElementById('servicesCatalogGrid');
    if (!grid) return;

    let list = SERVICES_DATA.filter(item => {
      const matchCat = (currentCategory === 'all') || (item.category === currentCategory);
      const matchKey = item.name.toLowerCase().includes(currentKeyword.toLowerCase()) || 
                       item.shortDesc.toLowerCase().includes(currentKeyword.toLowerCase());
      return matchCat && matchKey;
    });

    if (currentSort === 'price-asc') list.sort((a, b) => a.price - b.price);
    if (currentSort === 'price-desc') list.sort((a, b) => b.price - a.price);
    if (currentSort === 'duration') list.sort((a, b) => b.duration - a.duration);

    if (list.length === 0) {
      grid.innerHTML = `
        <div style="grid-column: 1 / -1; text-align: center; padding: 60px 20px;">
          <p style="font-size: 1.2rem; color: var(--text-light); margin-bottom: 15px;">Không tìm thấy dịch vụ nào phù hợp với từ khóa "${currentKeyword}".</p>
          <button class="btn-outline" id="btnResetFilter">Xem Tất Cả Dịch Vụ</button>
        </div>
      `;
      document.getElementById('btnResetFilter')?.addEventListener('click', () => {
        document.getElementById('serviceSearchInput').value = '';
        currentKeyword = '';
        currentCategory = 'all';
        document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.cat === 'all'));
        filterAndRender();
      });
      return;
    }

    grid.innerHTML = list.map(s => renderPackageCardHtml(s)).join('');
  };

  // Listeners
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentCategory = btn.getAttribute('data-cat');
      filterAndRender();
    });
  });

  document.getElementById('serviceSearchInput')?.addEventListener('input', (e) => {
    currentKeyword = e.target.value.trim();
    filterAndRender();
  });

  document.getElementById('serviceSortSelect')?.addEventListener('change', (e) => {
    currentSort = e.target.value;
    filterAndRender();
  });

  filterAndRender();
}

/* ==========================================================================
   3. TRANG CHI TIẾT DỊCH VỤ (SERVICE DETAIL PAGE #/services/:id)
   ========================================================================== */
function _legacy_renderServiceDetailPage(serviceId) {
  const root = document.getElementById('appRoot');
  const service = SERVICES_DATA.find(s => s.id === serviceId) || SERVICES_DATA[0];
  const imgInfo = getServiceImage(service);

  let selectedVariant = service.variants[0];

  root.innerHTML = `
    <div class="page-banner">
      <h1>${service.name}</h1>
      <p>${service.categoryName} • Trải nghiệm phục hồi tiêu chuẩn 5 sao</p>
      <div class="breadcrumbs">
        <a href="#/">Trang Chủ</a> / <a href="#/services">Dịch Vụ</a> / <span>${service.name}</span>
      </div>
    </div>

    <div class="container">
      <div class="detail-page-grid">
        <!-- Gallery / Image Left -->
        <div>
          <div class="detail-gallery-main">
            <img src="${imgInfo.url}" alt="${service.name}" />
          </div>
          <div style="background: var(--bg-cream); padding: 25px; border-radius: var(--radius-md); margin-top: 25px; border: 1px solid var(--border-color);">
            <h4 style="font-size: 1.15rem; margin-bottom: 10px; color: var(--primary-brown);">Cam Kết Dịch Vụ:</h4>
            <ul style="padding-left: 20px; font-size: 0.92rem; color: var(--text-light); line-height: 1.8;">
              <li>Không gian phòng trị liệu riêng tư, sạch sẽ, vô trùng</li>
              <li>Chuyên viên có chứng chỉ chuyên môn và đạo đức nghề nghiệp</li>
              <li>Hoàn tiền 100% nếu quý khách không hài lòng về chất lượng</li>
            </ul>
          </div>
        </div>

        <!-- Content & Variant Picker Right -->
        <div class="detail-content-wrap">
          <span style="font-size: 12px; font-weight: 600; text-transform: uppercase; color: var(--primary-brown); letter-spacing: 1px;">
            ${service.categoryName}
          </span>
          <h1>${service.name}</h1>
          
          <div class="detail-meta-row">
            <div class="detail-price-lg" id="detailPriceDisplay">${formatVND(selectedVariant.price)}</div>
            <div class="detail-duration-pill" id="detailDurationDisplay">⏱ ${selectedVariant.duration} Phút</div>
            <div style="font-size: 0.9rem; color: #D4A017;">★ ${service.rating} (${service.reviewsCount} đánh giá)</div>
          </div>

          <p style="font-size: 1.05rem; line-height: 1.8; margin-bottom: 25px;">
            ${service.fullDesc}
          </p>

          <!-- Chọn Thời Lượng Biến Thể -->
          <div class="variant-selection-box">
            <label style="font-weight: 600; font-size: 0.95rem; color: var(--text-dark);">
              Chọn Thời Lượng Liệu Trình Mong Muốn:
            </label>
            <div class="variant-picker-btns">
              ${service.variants.map((v, idx) => `
                <button type="button" class="variant-choice-btn ${idx === 0 ? 'active' : ''}" data-duration="${v.duration}" data-price="${v.price}">
                  ${v.duration} Phút (${formatVND(v.price)})
                </button>
              `).join('')}
            </div>
          </div>

          <!-- Lợi Ích Trị Liệu -->
          <div style="margin-bottom: 35px;">
            <h3 style="font-size: 1.35rem; margin-bottom: 15px;">Lợi Ích Của Liệu Trình:</h3>
            <ul style="list-style: none;">
              ${service.benefits.map(b => `
                <li style="display: flex; gap: 10px; margin-bottom: 10px; font-size: 0.95rem; color: var(--text-dark);">
                  <span style="color: var(--primary-green); font-weight: 700;">✓</span>
                  <span>${b}</span>
                </li>
              `).join('')}
            </ul>
          </div>

          <!-- CTA Buttons -->
          <div style="display: flex; gap: 15px;">
            <a href="#/booking?service=${service.id}" class="btn-primary" style="flex: 1; padding: 16px 0; font-size: 1rem; text-align: center;">
              Đặt Lịch Liệu Trình Này Ngay
            </a>
            <a href="#/services" class="btn-outline">
              ← Xem Dịch Vụ Khác
            </a>
          </div>
        </div>
      </div>
    </div>
  `;

  // Variant change event
  document.querySelectorAll('.variant-choice-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.variant-choice-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const dur = parseInt(btn.dataset.duration, 10);
      const pr = parseInt(btn.dataset.price, 10);
      document.getElementById('detailPriceDisplay').textContent = formatVND(pr);
      document.getElementById('detailDurationDisplay').textContent = `⏱ ${dur} Phút`;
    });
  });
}

/* ==========================================================================
   4. TRANG ĐẶT LỊCH (BOOKING WIZARD PAGE #/booking)
   ========================================================================== */
function _legacy_renderBookingPage(preSelectedServiceId = null) {
  const root = document.getElementById('appRoot');

  // Lấy dịch vụ mặc định hoặc dịch vụ được chọn trước
  const initialService = SERVICES_DATA.find(s => s.id === preSelectedServiceId) || SERVICES_DATA[0];

  let wizardState = {
    service: initialService,
    variant: initialService.variants[0],
    staff: STAFF_DATA[0],
    date: '2026-10-15',
    slot: '10:00',
    custName: 'Trần Đình Tịnh',
    custPhone: '0912345678',
    custEmail: 'customer@serenity.demo',
    note: '',
    promoCode: '',
    discount: 0,
    finalPrice: initialService.variants[0].price
  };

  let currentStep = 1;

  root.innerHTML = `
    <div class="page-banner">
      <h1>Đặt Lịch Trải Nghiệm</h1>
      <p>Hệ thống đặt hẹn thông minh tại Serenity Spa &amp; Wellness. Xác nhận tức thì không chờ đợi.</p>
      <div class="breadcrumbs">
        <a href="#/">Trang Chủ</a> / <span>Đặt Lịch</span>
      </div>
    </div>

    <div class="container" style="padding-top: 50px;">
      <div class="booking-page-container">
        <!-- Steps Header Bar -->
        <div class="booking-steps-bar">
          <div class="booking-step-badge active" data-step="1">
            <span class="step-num">1</span> Chọn Dịch Vụ
          </div>
          <div class="booking-step-badge" data-step="2">
            <span class="step-num">2</span> Chọn Chuyên Viên
          </div>
          <div class="booking-step-badge" data-step="3">
            <span class="step-num">3</span> Ngày &amp; Khung Giờ
          </div>
          <div class="booking-step-badge" data-step="4">
            <span class="step-num">4</span> Xác Nhận Thông Tin
          </div>
        </div>

        <!-- Step Panes -->
        <div class="booking-page-body">
          <!-- Step 1: Dịch vụ -->
          <div class="wizard-step-pane active" id="bStep1">
            <h3 style="margin-bottom: 20px;">Bước 1: Chọn Liệu Trình &amp; Thời Lượng</h3>
            <div id="bookingServiceOptionsList">
              ${SERVICES_DATA.map(s => `
                <div class="service-option-item ${s.id === wizardState.service.id ? 'selected' : ''}" data-sid="${s.id}">
                  <div>
                    <h4 style="font-size: 1.2rem; color: var(--primary-brown);">${s.name}</h4>
                    <p style="font-size: 0.85rem; color: var(--text-light);">${s.shortDesc}</p>
                    <div class="variant-btn-group">
                      ${s.variants.map(v => `
                        <button type="button" class="variant-btn ${s.id === wizardState.service.id && v.duration === wizardState.variant.duration ? 'selected' : ''}" data-sid="${s.id}" data-dur="${v.duration}">
                          ${v.duration} Phút - ${formatVND(v.price)}
                        </button>
                      `).join('')}
                    </div>
                  </div>
                  <div style="font-weight: 700; color: var(--primary-brown); font-size: 1.2rem;">
                    ${formatVND(s.price)}
                  </div>
                </div>
              `).join('')}
            </div>
          </div>

          <!-- Step 2: Chuyên viên -->
          <div class="wizard-step-pane" id="bStep2">
            <h3 style="margin-bottom: 20px;">Bước 2: Chọn Chuyên Viên Trị Liệu</h3>
            <div class="staff-option-grid">
              ${STAFF_DATA.map(st => `
                <div class="staff-card-option ${st.id === wizardState.staff.id ? 'selected' : ''}" data-stid="${st.id}">
                  <img src="${getImageById(st.imageId).url}" alt="${st.name}" class="staff-thumb-mini" />
                  <div>
                    <h4 style="font-size: 1.15rem; color: var(--primary-brown);">${st.name}</h4>
                    <p style="font-size: 0.82rem; color: var(--text-light);">${st.title}</p>
                    <span style="font-size: 11px; background: var(--bg-cream); color: var(--primary-brown); padding: 2px 8px; border-radius: 10px;">Chuyên môn phù hợp</span>
                  </div>
                </div>
              `).join('')}
            </div>
          </div>

          <!-- Step 3: Ngày & Khung Giờ -->
          <div class="wizard-step-pane" id="bStep3">
            <h3 style="margin-bottom: 20px;">Bước 3: Chọn Ngày Và Khung Giờ Khả Dụng</h3>
            <div class="datetime-grid">
              <div class="mini-cal">
                <div class="cal-header">
                  <span>Tháng 10, 2026</span>
                  <span style="font-size: 12px; color: var(--text-muted);">Múi giờ Asia/Ho_Chi_Minh</span>
                </div>
                <div class="cal-grid">
                  <span style="font-weight: 600; font-size: 11px;">T2</span>
                  <span style="font-weight: 600; font-size: 11px;">T3</span>
                  <span style="font-weight: 600; font-size: 11px;">T4</span>
                  <span style="font-weight: 600; font-size: 11px;">T5</span>
                  <span style="font-weight: 600; font-size: 11px;">T6</span>
                  <span style="font-weight: 600; font-size: 11px;">T7</span>
                  <span style="font-weight: 600; font-size: 11px;">CN</span>

                  <span class="cal-cell disabled">12</span>
                  <span class="cal-cell disabled">13</span>
                  <span class="cal-cell disabled">14</span>
                  <span class="cal-cell selected" data-day="15">15</span>
                  <span class="cal-cell" data-day="16">16</span>
                  <span class="cal-cell" data-day="17">17</span>
                  <span class="cal-cell" data-day="18">18</span>
                  <span class="cal-cell" data-day="19">19</span>
                  <span class="cal-cell" data-day="20">20</span>
                  <span class="cal-cell" data-day="21">21</span>
                  <span class="cal-cell" data-day="22">22</span>
                  <span class="cal-cell" data-day="23">23</span>
                  <span class="cal-cell" data-day="24">24</span>
                  <span class="cal-cell" data-day="25">25</span>
                </div>
              </div>

              <div>
                <p style="font-size: 0.9rem; font-weight: 600; margin-bottom: 12px; color: var(--text-dark);">
                  Các khung giờ còn trống trong ngày:
                </p>
                <div class="slots-grid">
                  ${['09:30', '10:30', '11:30', '14:00', '15:00', '16:30', '18:00', '19:30'].map(t => `
                    <button type="button" class="slot-btn ${t === wizardState.slot ? 'selected' : ''}" data-slot="${t}">
                      ${t}
                    </button>
                  `).join('')}
                </div>
              </div>
            </div>
          </div>

          <!-- Step 4: Thông Tin & Xác Nhận -->
          <div class="wizard-step-pane" id="bStep4">
            <h3 style="margin-bottom: 20px;">Bước 4: Thông Tin Khách Hàng &amp; Xác Nhận</h3>
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 20px;">
              <div class="form-group">
                <label>Họ và tên quý khách *</label>
                <input type="text" id="bCustName" class="form-control" value="${wizardState.custName}" />
              </div>
              <div class="form-group">
                <label>Số điện thoại liên hệ *</label>
                <input type="tel" id="bCustPhone" class="form-control" value="${wizardState.custPhone}" />
              </div>
            </div>
            <div class="form-group">
              <label>Email nhận xác nhận đặt hẹn</label>
              <input type="email" id="bCustEmail" class="form-control" value="${wizardState.custEmail}" />
            </div>
            <div class="form-group">
              <label>Ghi chú đặc biệt (yêu cầu lực massage, vị trí cần tập trung...)</label>
              <textarea id="bCustNote" class="form-control" rows="2" placeholder="Ví dụ: Tập trung giảm mỏi vùng thắt lưng..."></textarea>
            </div>

            <!-- Mã giảm giá -->
            <div style="display: flex; gap: 10px; margin-bottom: 20px; align-items: flex-end;">
              <div style="flex-grow: 1;">
                <label style="font-size: 0.88rem; font-weight: 600;">Mã khuyến mãi (Thử: SERENITY10 hoặc VIP20)</label>
                <input type="text" id="bPromoInput" class="form-control" placeholder="Nhập mã SERENITY10..." style="text-transform: uppercase;" />
              </div>
              <button type="button" class="btn-outline" id="bApplyPromoBtn" style="height: 47px;">Áp Dụng</button>
            </div>

            <!-- Bảng Tóm Tắt Chi Phí -->
            <div class="booking-summary-box">
              <div class="summary-line">
                <span>Dịch vụ lựa chọn:</span>
                <strong id="bSumService">${wizardState.service.name}</strong>
              </div>
              <div class="summary-line">
                <span>Thời lượng liệu trình:</span>
                <span id="bSumDuration">${wizardState.variant.duration} Phút</span>
              </div>
              <div class="summary-line">
                <span>Chuyên viên phụ trách:</span>
                <strong id="bSumStaff">${wizardState.staff.name}</strong>
              </div>
              <div class="summary-line">
                <span>Thời gian hẹn:</span>
                <span id="bSumTime">${wizardState.slot} - Ngày ${wizardState.date}</span>
              </div>
              <div class="summary-line">
                <span>Giá gốc:</span>
                <span id="bSumOriginalPrice">${formatVND(wizardState.variant.price)}</span>
              </div>
              <div class="summary-line" style="color: var(--primary-green);">
                <span>Giảm giá:</span>
                <span id="bSumDiscount">-0₫</span>
              </div>
              <div class="summary-line total">
                <span>Tổng chi phí dự kiến:</span>
                <span id="bSumFinalPrice">${formatVND(wizardState.finalPrice)}</span>
              </div>
            </div>
          </div>
        </div>

        <!-- Footer Buttons -->
        <div class="booking-footer">
          <button type="button" class="btn-outline" id="bPrevBtn" style="display: none;">← Quay Lại</button>
          <div></div>
          <button type="button" class="btn-primary" id="bNextBtn">Tiếp Tục: Chọn Chuyên Viên →</button>
        </div>
      </div>
    </div>
  `;

  // Stepper Controller
  const updateWizardUI = () => {
    document.querySelectorAll('.booking-step-badge').forEach(b => {
      const step = parseInt(b.dataset.step, 10);
      b.classList.remove('active', 'completed');
      if (step === currentStep) b.classList.add('active');
      if (step < currentStep) b.classList.add('completed');
    });

    document.querySelectorAll('.wizard-step-pane').forEach((p, idx) => {
      p.classList.toggle('active', idx + 1 === currentStep);
    });

    const prevBtn = document.getElementById('bPrevBtn');
    const nextBtn = document.getElementById('bNextBtn');

    if (currentStep === 1) {
      prevBtn.style.display = 'none';
      nextBtn.textContent = 'Tiếp Tục: Chọn Chuyên Viên →';
    } else if (currentStep === 2) {
      prevBtn.style.display = 'inline-flex';
      nextBtn.textContent = 'Tiếp Tục: Chọn Ngày & Giờ →';
    } else if (currentStep === 3) {
      prevBtn.style.display = 'inline-flex';
      nextBtn.textContent = 'Tiếp Tục: Xác Nhận Thông Tin →';
    } else if (currentStep === 4) {
      prevBtn.style.display = 'inline-flex';
      nextBtn.textContent = '✓ Hoàn Tất & Xác Nhận Đặt Lịch';
      // Cập nhật summary
      document.getElementById('bSumService').textContent = wizardState.service.name;
      document.getElementById('bSumDuration').textContent = `${wizardState.variant.duration} Phút`;
      document.getElementById('bSumStaff').textContent = wizardState.staff.name;
      document.getElementById('bSumTime').textContent = `${wizardState.slot} - Ngày ${wizardState.date}`;
      document.getElementById('bSumOriginalPrice').textContent = formatVND(wizardState.variant.price);
      document.getElementById('bSumDiscount').textContent = formatVND(wizardState.discount);
      document.getElementById('bSumFinalPrice').textContent = formatVND(wizardState.finalPrice);
    }
  };

  // Step 1 Events
  document.getElementById('bookingServiceOptionsList')?.addEventListener('click', (e) => {
    const item = e.target.closest('.service-option-item');
    if (!item) return;
    const sid = item.dataset.sid;
    const srv = SERVICES_DATA.find(s => s.id === sid);
    if (!srv) return;

    if (e.target.classList.contains('variant-btn')) {
      const dur = parseInt(e.target.dataset.dur, 10);
      const chosenVar = srv.variants.find(v => v.duration === dur);
      wizardState.service = srv;
      wizardState.variant = chosenVar;
      wizardState.finalPrice = chosenVar.price - wizardState.discount;
    } else {
      wizardState.service = srv;
      wizardState.variant = srv.variants[0];
      wizardState.finalPrice = srv.variants[0].price - wizardState.discount;
    }

    document.querySelectorAll('.service-option-item').forEach(el => el.classList.remove('selected'));
    item.classList.add('selected');
    item.querySelectorAll('.variant-btn').forEach(vb => {
      vb.classList.toggle('selected', parseInt(vb.dataset.dur, 10) === wizardState.variant.duration);
    });
  });

  // Step 2 Events
  document.querySelectorAll('.staff-card-option').forEach(card => {
    card.addEventListener('click', () => {
      document.querySelectorAll('.staff-card-option').forEach(c => c.classList.remove('selected'));
      card.classList.add('selected');
      const stid = card.dataset.stid;
      wizardState.staff = STAFF_DATA.find(st => st.id === stid) || STAFF_DATA[0];
    });
  });

  // Step 3 Events
  document.querySelectorAll('.cal-cell:not(.disabled)').forEach(cell => {
    cell.addEventListener('click', () => {
      document.querySelectorAll('.cal-cell').forEach(c => c.classList.remove('selected'));
      cell.classList.add('selected');
      wizardState.date = `2026-10-${cell.dataset.day}`;
    });
  });

  document.querySelectorAll('.slot-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.slot-btn').forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
      wizardState.slot = btn.dataset.slot;
    });
  });

  // Promo code
  document.getElementById('bApplyPromoBtn')?.addEventListener('click', () => {
    const code = document.getElementById('bPromoInput').value.trim().toUpperCase();
    if (code === 'SERENITY10') {
      wizardState.promoCode = code;
      wizardState.discount = Math.round(wizardState.variant.price * 0.1);
      wizardState.finalPrice = wizardState.variant.price - wizardState.discount;
      showToast('Áp dụng mã SERENITY10 giảm 10% thành công!', 'success');
    } else if (code === 'VIP20') {
      wizardState.promoCode = code;
      wizardState.discount = Math.round(wizardState.variant.price * 0.2);
      wizardState.finalPrice = wizardState.variant.price - wizardState.discount;
      showToast('Áp dụng mã VIP20 giảm 20% thành công!', 'success');
    } else {
      showToast('Mã khuyến mãi không hợp lệ.', 'danger');
    }
    updateWizardUI();
  });

  // Nav Buttons
  document.getElementById('bNextBtn')?.addEventListener('click', () => {
    if (currentStep < 4) {
      currentStep++;
      updateWizardUI();
    } else {
      // Validate & Save to LocalStorage
      const name = document.getElementById('bCustName').value.trim();
      const phone = document.getElementById('bCustPhone').value.trim();
      const email = document.getElementById('bCustEmail').value.trim();
      const note = document.getElementById('bCustNote').value.trim();

      if (!name || !phone) {
        showToast('Vui lòng điền họ tên và số điện thoại liên hệ.', 'danger');
        return;
      }

      const bookingCode = 'SER-' + Math.floor(100000 + Math.random() * 900000);
      const newBooking = {
        code: bookingCode,
        serviceName: wizardState.service.name,
        duration: wizardState.variant.duration,
        staffName: wizardState.staff.name,
        date: wizardState.date,
        slot: wizardState.slot,
        customerName: name,
        phone: phone,
        email: email,
        note: note,
        finalPrice: wizardState.finalPrice,
        status: 'Confirmed',
        createdAt: new Date().toISOString()
      };

      const existing = JSON.parse(localStorage.getItem('serenity_bookings') || '[]');
      existing.unshift(newBooking);
      localStorage.setItem('serenity_bookings', JSON.stringify(existing));

      showToast(`Đặt lịch thành công! Mã xác nhận của bạn là ${bookingCode}`, 'success');

      // Chuyển sang trang Lịch Của Tôi
      setTimeout(() => {
        window.location.hash = '#/my-bookings';
      }, 1000);
    }
  });

  document.getElementById('bPrevBtn')?.addEventListener('click', () => {
    if (currentStep > 1) {
      currentStep--;
      updateWizardUI();
    }
  });
}

/* ==========================================================================
   5. TRANG GIỚI THIỆU (ABOUT US PAGE #/about)
   ========================================================================== */
function renderAboutPage() {
  const root = document.getElementById('appRoot');
  const img1 = getImageById('interior-01');
  const img2 = getImageById('interior-02');

  root.innerHTML = `
    <div class="page-banner">
      <h1>Về Chúng Tôi — Serenity Spa</h1>
      <p>Câu chuyện hình thành chốn nghỉ dưỡng an yên giữa lòng Quận 1, TP. Hồ Chí Minh</p>
      <div class="breadcrumbs">
        <a href="#/">Trang Chủ</a> / <span>Về Chúng Tôi</span>
      </div>
    </div>

    <div class="container">
      <div class="about-split" style="margin-bottom: 70px;">
        <div class="about-content">
          <span style="font-size: 13px; font-weight: 600; text-transform: uppercase; color: var(--primary-brown); letter-spacing: 2px;">
            TRIẾT LÝ DƯỠNG SINH
          </span>
          <h2>Trở Về Với Sự Tĩnh Lặng Nguyên Bản</h2>
          <p>Serenity Spa &amp; Wellness mang đến một không gian thư giãn giữa nhịp sống sôi động của Sài Gòn, nơi bạn có thể dành thời gian nghỉ ngơi và chăm sóc bản thân.</p>
          <p>Chúng tôi tin rằng sự thư giãn đích thực bắt nguồn từ sự kết hợp hài hòa giữa không gian cách âm riêng tư, ánh sáng vàng dịu mắt, mùi hương tinh dầu thiên nhiên và sự ân cần của những kỹ thuật viên lành nghề.</p>
        </div>
        <div class="about-img">
          <img src="${img1.url}" alt="Serenity Spa Retreat" />
        </div>
      </div>

      <div class="about-split" style="direction: rtl;">
        <div class="about-content" style="direction: ltr;">
          <span style="font-size: 13px; font-weight: 600; text-transform: uppercase; color: var(--primary-brown); letter-spacing: 2px;">
            TIÊU CHUẨN DỊCH VỤ
          </span>
          <h2>Cam Kết An Toàn &amp; Vệ Sinh 100%</h2>
          <p>Tất cả các phòng trị liệu tại Serenity Spa đều được trang bị hệ thống lọc khí tươi, khăn ga và áo choàng được giặt sấy tiệt trùng sau mỗi lượt khách.</p>
          <p>Chúng tôi chỉ sử dụng các dòng tinh dầu hữu cơ ép lạnh không pha tạp chất hóa học, an toàn tuyệt đối cho mọi làn da nhạy cảm nhất.</p>
          <a href="#/booking" class="btn-primary" style="margin-top: 15px;">Đặt Lịch Thư Giãn Ngay</a>
        </div>
        <div class="about-img">
          <img src="${img2.url}" alt="Phòng trị liệu Serenity" />
        </div>
      </div>
    </div>
  `;
}

/* ==========================================================================
   6. TRANG LIÊN HỆ & BẢN ĐỒ (CONTACT US PAGE #/contact)
   ========================================================================== */
function renderContactPage() {
  const root = document.getElementById('appRoot');

  root.innerHTML = `
    <div class="page-banner">
      <h1>Liên Hệ &amp; Hướng Dẫn Chỉ Đường</h1>
      <p>Chúng tôi luôn sẵn sàng lắng nghe và hỗ trợ bạn đặt lịch chu đáo nhất</p>
      <div class="breadcrumbs">
        <a href="#/">Trang Chủ</a> / <span>Liên Hệ</span>
      </div>
    </div>

    <div class="container">
      <div class="contact-grid">
        <!-- Thông Tin Liên Hệ Left -->
        <div class="contact-info-card">
          <h2 style="font-size: 2.2rem; margin-bottom: 25px;">Serenity Spa &amp; Wellness</h2>
          
          <div class="contact-item">
            <div class="contact-icon">📍</div>
            <div>
              <strong style="color: var(--text-dark); display: block; margin-bottom: 4px;">Địa Chỉ:</strong>
              <p>${SERENITY_ADDRESS}</p>
            </div>
          </div>

          <div class="contact-item">
            <div class="contact-icon">📅</div>
            <div>
              <strong style="color: var(--text-dark); display: block; margin-bottom: 4px;">Đặt Lịch:</strong>
              <p><a href="#/booking">Chọn liệu trình và khung giờ trực tuyến</a></p>
            </div>
          </div>
        </div>

        <!-- Form Gửi Tin Nhắn Right -->
        <div style="background: #FFFFFF; padding: 40px; border-radius: var(--radius-md); border: 1px solid var(--border-color); box-shadow: var(--shadow-sm);">
          <h3 style="font-size: 1.8rem; margin-bottom: 15px;">Gửi Tin Nhắn Cho Chúng Tôi</h3>
          <p style="margin-bottom: 25px; font-size: 0.95rem;">Vui lòng điền thông tin bên dưới để gửi lời nhắn đến Serenity Spa &amp; Wellness.</p>

          <form id="contactForm">
            <div class="form-group">
              <label>Họ và tên *</label>
              <input type="text" id="cntName" class="form-control" required placeholder="Nguyễn Văn A" />
            </div>
            <div class="form-group">
              <label>Số điện thoại *</label>
              <input type="tel" id="cntPhone" class="form-control" required placeholder="0901234567" />
            </div>
            <div class="form-group">
              <label>Chủ đề</label>
              <input type="text" id="cntSubject" class="form-control" placeholder="Tư vấn gói trị liệu, đặt tiệc spa nhóm..." />
            </div>
            <div class="form-group">
              <label>Nội dung tin nhắn *</label>
              <textarea id="cntMsg" class="form-control" rows="4" required placeholder="Nội dung cần trao đổi..."></textarea>
            </div>
            <button type="submit" class="btn-primary" style="width: 100%;">Gửi Tin Nhắn Ngay</button>
          </form>
        </div>
      </div>

      <!-- Google Maps Embed Section -->
      <div style="margin-top: 60px;">
        <h3 style="font-size: 1.8rem; margin-bottom: 20px; text-align: center;">Bản Đồ Đến Serenity Spa — 285B Đường Hoàng Sa</h3>
        <div style="border-radius: 8px; overflow: hidden; height: 380px; box-shadow: var(--shadow-sm); border: 1px solid var(--border-color);">
          <iframe 
            src="${SERENITY_MAP_EMBED}"
            width="100%" 
            height="100%" 
            style="border:0;" 
            allowfullscreen="" 
            loading="lazy">
          </iframe>
        </div>
      </div>
    </div>
  `;

  // Contact form submit
  document.getElementById('contactForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = document.getElementById('cntName')?.value.trim();
    const phone = document.getElementById('cntPhone')?.value.trim();
    const subject = document.getElementById('cntSubject')?.value.trim();
    const message = document.getElementById('cntMsg')?.value.trim();

    try {
      await contactService.create({ name, phone, subject, message });
      showToast(`Cảm ơn bạn ${name}! Chúng tôi đã ghi nhận tin nhắn và sẽ liên hệ hỗ trợ sớm nhất.`, 'success');
      e.target.reset();
    } catch (err) {
      showToast(err.message || 'Lỗi gửi tin nhắn.', 'danger');
    }
  });
}

/* ==========================================================================
   7. TRANG LỊCH CỦA TÔI (MY BOOKINGS PAGE #/my-bookings)
   ========================================================================== */
function _legacy_renderMyBookingsPage() {
  const root = document.getElementById('appRoot');

  // Lấy danh sách booking từ localStorage
  const savedList = JSON.parse(localStorage.getItem('serenity_bookings') || '[]');

  // Nếu rỗng, nạp sẵn 1 booking mẫu để demo
  if (savedList.length === 0) {
    savedList.push({
      code: 'SER-882194',
      serviceName: 'Signature Body Massage',
      duration: 90,
      staffName: 'Mai Linh',
      date: '2026-10-18',
      slot: '14:00',
      customerName: 'Trần Đình Tịnh',
      phone: '0912345678',
      finalPrice: 680000,
      status: 'Confirmed',
      createdAt: new Date().toISOString()
    });
    localStorage.setItem('serenity_bookings', JSON.stringify(savedList));
  }

  root.innerHTML = `
    <div class="page-banner">
      <h1>Lịch Hẹn Của Tôi</h1>
      <p>Quản lý và tra cứu trạng thái các buổi chăm sóc sức khỏe của bạn tại Serenity Spa</p>
      <div class="breadcrumbs">
        <a href="#/">Trang Chủ</a> / <span>Lịch Hẹn Của Tôi</span>
      </div>
    </div>

    <div class="container">
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 30px;">
        <h2>Danh Sách Lịch Đã Đặt (${savedList.length})</h2>
        <a href="#/booking" class="btn-primary">+ Đặt Thêm Lịch Mới</a>
      </div>

      <div class="bookings-table-wrap">
        <table class="bookings-table">
          <thead>
            <tr>
              <th>Mã Đặt Lịch</th>
              <th>Dịch Vụ</th>
              <th>Thời Lượng</th>
              <th>Chuyên Viên</th>
              <th>Ngày &amp; Giờ</th>
              <th>Chi Phí</th>
              <th>Trạng Thái</th>
              <th>Thao Tác</th>
            </tr>
          </thead>
          <tbody>
            ${savedList.map(b => `
              <tr>
                <td><strong>${b.code}</strong></td>
                <td>${b.serviceName}</td>
                <td>${b.duration} Phút</td>
                <td>${b.staffName}</td>
                <td>${b.slot} • ${b.date}</td>
                <td><strong style="color: var(--primary-brown);">${formatVND(b.finalPrice)}</strong></td>
                <td>
                  <span class="badge-status ${b.status === 'Confirmed' ? 'badge-confirmed' : b.status === 'Completed' ? 'badge-completed' : 'badge-pending'}">
                    ${b.status}
                  </span>
                </td>
                <td>
                  ${b.status !== 'Cancelled' ? `
                    <button class="btn-outline btn-cancel-booking" data-code="${b.code}" style="padding: 6px 14px; font-size: 11px;">
                      Hủy Lịch
                    </button>
                  ` : '<span style="color: var(--text-muted); font-size: 12px;">Đã hủy</span>'}
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    </div>
  `;

  // Cancel booking event
  document.querySelectorAll('.btn-cancel-booking').forEach(btn => {
    btn.addEventListener('click', () => {
      const code = btn.dataset.code;
      if (confirm(`Bạn có chắc chắn muốn hủy lịch hẹn mã ${code}? (Theo chính sách, hủy trước giờ hẹn tối thiểu 4 tiếng)`)) {
        const list = JSON.parse(localStorage.getItem('serenity_bookings') || '[]');
        const target = list.find(item => item.code === code);
        if (target) {
          target.status = 'Cancelled';
          localStorage.setItem('serenity_bookings', JSON.stringify(list));
          showToast(`Đã hủy lịch hẹn ${code} thành công.`, 'success');
          renderMyBookingsPage();
        }
      }
    });
  });
}

/* ==========================================================================
   8. TRANG QUẢN TRỊ ADMIN (ADMIN DASHBOARD #/admin)
   ========================================================================== */
function _legacy_renderAdminDashboardPage() {
  const root = document.getElementById('appRoot');
  const savedList = JSON.parse(localStorage.getItem('serenity_bookings') || '[]');

  const totalBookings = savedList.length;
  const confirmedCount = savedList.filter(b => b.status === 'Confirmed').length;
  const totalRevenue = savedList
    .filter(b => b.status !== 'Cancelled')
    .reduce((sum, b) => sum + (b.finalPrice || 0), 0);

  root.innerHTML = `
    <div class="page-banner" style="background: #332617;">
      <h1>Bảng Điều Khiển Quản Trị (Admin Portal)</h1>
      <p>Giám sát hiệu quả hoạt động, KPI lịch hẹn và doanh thu mô phỏng theo thời gian thực</p>
      <div class="breadcrumbs">
        <a href="#/">Trang Chủ</a> / <span>Hệ Thống Quản Trị</span>
      </div>
    </div>

    <div class="container">
      <!-- KPI Stats Grid -->
      <div class="admin-stats-grid">
        <div class="stat-card">
          <h4>Tổng Lịch Hẹn</h4>
          <div class="stat-val">${totalBookings}</div>
          <p style="font-size: 12px; color: var(--text-muted);">Được lưu trong LocalStorage</p>
        </div>
        <div class="stat-card">
          <h4>Lịch Đã Xác Nhận</h4>
          <div class="stat-val" style="color: var(--primary-green);">${confirmedCount}</div>
          <p style="font-size: 12px; color: var(--text-muted);">Sẵn sàng phục vụ</p>
        </div>
        <div class="stat-card">
          <h4>Tổng Doanh Thu Mô Phỏng</h4>
          <div class="stat-val" style="font-size: 1.8rem; color: var(--primary-brown);">${formatVND(totalRevenue)}</div>
          <p style="font-size: 12px; color: var(--text-muted);">Tính toán từ các lịch hợp lệ</p>
        </div>
        <div class="stat-card">
          <h4>Tổng Dịch Vụ</h4>
          <div class="stat-val">${SERVICES_DATA.length}</div>
          <p style="font-size: 12px; color: var(--text-muted);">Đang kích hoạt trên website</p>
        </div>
      </div>

      <!-- Bookings Management Table -->
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 25px;">
        <h2>Quản Lý Lịch Hẹn Gần Đây</h2>
        <button class="btn-outline" id="btnAdminResetSeed" style="font-size: 12px;">
          🔄 Đặt Lại Dữ Liệu Demo Ban Đầu
        </button>
      </div>

      <div class="bookings-table-wrap">
        <table class="bookings-table">
          <thead>
            <tr>
              <th>Mã Lịch</th>
              <th>Khách Hàng</th>
              <th>Số Điện Thoại</th>
              <th>Dịch Vụ</th>
              <th>Chuyên Viên</th>
              <th>Ngày &amp; Giờ</th>
              <th>Chi Phí</th>
              <th>Trạng Thái</th>
            </tr>
          </thead>
          <tbody>
            ${savedList.map(b => `
              <tr>
                <td><strong>${b.code}</strong></td>
                <td>${b.customerName || 'Khách demo'}</td>
                <td>${b.phone || '0901234567'}</td>
                <td>${b.serviceName}</td>
                <td>${b.staffName}</td>
                <td>${b.slot} • ${b.date}</td>
                <td>${formatVND(b.finalPrice)}</td>
                <td>
                  <span class="badge-status ${b.status === 'Confirmed' ? 'badge-confirmed' : b.status === 'Completed' ? 'badge-completed' : 'badge-pending'}">
                    ${b.status}
                  </span>
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    </div>
  `;

  document.getElementById('btnAdminResetSeed')?.addEventListener('click', () => {
    if (confirm('Bạn có chắc muốn đặt lại toàn bộ dữ liệu demo về trạng thái ban đầu?')) {
      localStorage.removeItem('serenity_bookings');
      showToast('Đã khôi phục dữ liệu demo ban đầu.', 'success');
      renderAdminDashboardPage();
    }
  });
}

/* ==========================================================================
   HTML CARD GENERATOR & INTERACTIVE MODAL
   ========================================================================== */
function _legacy_openServiceModal(serviceId) {
  const service = SERVICES_DATA.find(s => s.id === serviceId);
  if (!service) return;

  const modal = document.getElementById('serviceModal');
  const body = document.getElementById('serviceModalBody');
  if (!modal || !body) return;

  const imgInfo = getServiceImage(service);

  body.innerHTML = `
    <div class="modal-img-container">
      <img src="${imgInfo.url}" alt="${service.name}" />
    </div>
    <div class="modal-info">
      <span class="package-badge" style="display: inline-block; width: fit-content; margin-bottom: 12px; background: rgba(142, 110, 63, 0.12); color: var(--primary-brown); padding: 5px 12px; border-radius: 4px; font-size: 11px; text-transform: uppercase; font-weight: 600;">
        ${service.categoryName}
      </span>
      <h3 style="font-family: var(--font-heading); font-size: 1.8rem; color: var(--text-dark); margin-bottom: 10px;">${service.name}</h3>
      <div style="font-size: 15px; font-weight: 600; color: var(--primary-brown); margin-bottom: 15px;">
        ⏱ ${service.duration} Phút • <span style="color: var(--accent-orange); font-size: 1.2rem;">${salePriceMarkup(getDisplayPricing(service))}</span>
      </div>
      <div class="modal-desc">
        <p style="color: var(--text-light); line-height: 1.7; margin-bottom: 15px;">${service.fullDesc || service.shortDesc}</p>
        <h4 style="font-size: 0.95rem; margin-top: 15px; margin-bottom: 10px; color: var(--text-dark); font-weight: 600;">Lợi Ích Liệu Trình:</h4>
        <ul style="padding-left: 20px; font-size: 0.88rem; line-height: 1.7; color: var(--text-light); margin-bottom: 20px;">
          ${(service.benefits || []).map(b => `<li style="margin-bottom: 6px;">${b}</li>`).join('')}
        </ul>
      </div>
      <div style="display: flex; gap: 12px; margin-top: 15px;">
        <a href="#/booking?service=${service.id}" class="btn-primary" style="flex: 1; text-align: center; text-decoration: none;" onclick="document.getElementById('serviceModal').classList.remove('show')">
          Đặt Lịch Ngay
        </a>
        <a href="#/services/${service.id}" class="btn-outline" style="flex: 1; text-align: center; text-decoration: none;" onclick="document.getElementById('serviceModal').classList.remove('show')">
          Xem Trang Riêng
        </a>
      </div>
    </div>
  `;

  modal.classList.add('show');
}

window.openServiceModal = openServiceModal;

function renderPackageCardHtml(service) {
  const imgInfo = getServiceImage(service);
  return `
    <div class="package-card">
      <div class="package-img">
        <img src="${imgInfo.url}" alt="${service.name}" loading="lazy" />
        <span class="package-badge">${service.categoryName}</span>
      </div>
      <div class="package-info">
        <h3>${service.name}</h3>
        <div class="service-duration">⏱ ${service.duration} Phút • ${salePriceMarkup(getDisplayPricing(service))}</div>
        <p class="card-desc">${service.shortDesc}</p>
        <div class="service-actions">
          <button type="button" class="view-details-btn" onclick="window.openServiceModal('${service.id}')">Xem Chi Tiết</button>
          <a href="#/booking?service=${service.id}" class="btn-primary">Đặt Lịch Ngay</a>
        </div>
      </div>
    </div>
  `;
}

/* ==========================================================================
   TOAST NOTIFICATION UTILITY
   ========================================================================== */
function _legacy_showToast(message, type = 'normal') {
  const container = document.getElementById('toastContainer');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = `
    <span>${type === 'success' ? '✓' : type === 'danger' ? '⚠' : 'ℹ'}</span>
    <span>${message}</span>
  `;

  container.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(10px)';
    toast.style.transition = 'all 0.3s ease';
    setTimeout(() => toast.remove(), 300);
  }, 4000);
}
