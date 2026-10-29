export const ADDITIONAL_PACKAGE_SEED_IDS = Object.freeze([
  'moc-tam-duong-sinh',
  'lam-moi-tha-long',
  'deo-dai-nhe-chan',
  'am-da-sang-da',
  'goi-thao-moc-cham-da',
]);

export const ADDITIONAL_THERAPY_SEEDS = Object.freeze([
  {
    id: 'neck-shoulder-relax',
    kind: 'therapy',
    therapyGroup: 'neck-shoulder',
    name: 'Massage Cổ Vai Gáy Thư Giãn',
    category: 'focus-therapy',
    categoryName: 'Focus Therapy',
    imageId: 'therapy-neck-01',
    duration: 45,
    price: 350000,
    rating: 0,
    reviewsCount: 0,
    shortDesc: 'Buổi massage nhẹ nhàng tập trung vùng cổ, vai và gáy, điều chỉnh lực theo cảm nhận của khách.',
    fullDesc: 'Kỹ thuật viên trao đổi về mức lực mong muốn, sau đó kết hợp xoa vuốt và day ấn nhẹ đến vừa quanh vùng cổ, vai và gáy. Liệu trình phù hợp khi bạn muốn dành một khoảng nghỉ ngắn cho khu vực thường căng cứng sau ngày dài.',
    benefits: ['Tập trung vào vùng cổ, vai và gáy trong một buổi riêng', 'Có thể chọn lực massage nhẹ hoặc vừa', 'Thời lượng gọn, dễ sắp xếp trong ngày'],
    variants: [{ duration: 45, price: 350000 }, { duration: 60, price: 430000 }],
  },
  {
    id: 'neck-shoulder-acupressure',
    kind: 'therapy',
    therapyGroup: 'neck-shoulder',
    name: 'Bấm Huyệt Cổ Vai Gáy',
    category: 'focus-therapy',
    categoryName: 'Focus Therapy',
    imageId: 'therapy-neck-02',
    duration: 60,
    price: 450000,
    rating: 0,
    reviewsCount: 0,
    shortDesc: 'Các nhịp ấn huyệt có kiểm soát kết hợp massage vùng cổ, vai và phần lưng trên.',
    fullDesc: 'Buổi chăm sóc tập trung vào cổ, vai, gáy và lưng trên với những nhịp ấn ngắn, rõ lực xen kẽ thao tác massage chậm. Kỹ thuật viên sẽ hỏi lại cảm nhận trong quá trình thực hiện để điều chỉnh áp lực phù hợp.',
    benefits: ['Chọn lực ấn theo mức dễ chịu của khách', 'Bao gồm vùng lưng trên bên cạnh cổ vai gáy', 'Không cần kết hợp dịch vụ toàn thân'],
    variants: [{ duration: 60, price: 450000 }, { duration: 75, price: 530000 }],
  },
  {
    id: 'neck-shoulder-herbal-compress',
    kind: 'therapy',
    therapyGroup: 'neck-shoulder',
    name: 'Massage Vai Gáy Chườm Túi Thảo Mộc',
    category: 'focus-therapy',
    categoryName: 'Focus Therapy',
    imageId: 'therapy-neck-03',
    duration: 60,
    price: 490000,
    rating: 0,
    reviewsCount: 0,
    shortDesc: 'Massage vùng vai gáy kết hợp túi thảo mộc ấm, nhiệt độ được kiểm tra trước khi chườm.',
    fullDesc: 'Kỹ thuật viên dùng thao tác massage thư giãn ở vùng vai gáy, sau đó đặt túi thảo mộc ấm lên vùng cơ theo từng khoảng ngắn. Nhiệt độ được kiểm tra trước và điều chỉnh theo cảm nhận của khách.',
    benefits: ['Kết hợp massage tay và chườm ấm trong cùng buổi', 'Túi chườm được kiểm tra nhiệt độ trước khi dùng', 'Khách có thể yêu cầu giảm nhiệt hoặc bỏ bước chườm'],
    variants: [{ duration: 60, price: 490000 }, { duration: 75, price: 570000 }],
  },
  {
    id: 'neck-upperback-release',
    kind: 'therapy',
    therapyGroup: 'neck-shoulder',
    name: 'Thư Giãn Cổ Gáy & Lưng Trên',
    category: 'focus-therapy',
    categoryName: 'Focus Therapy',
    imageId: 'therapy-neck-04',
    duration: 75,
    price: 560000,
    rating: 0,
    reviewsCount: 0,
    shortDesc: 'Một buổi tập trung cổ gáy, bả vai và lưng trên với các động tác xoa vuốt, miết cơ nhịp nhàng.',
    fullDesc: 'Liệu trình mở rộng vùng chăm sóc xuống bả vai và lưng trên. Các thao tác được thực hiện theo nhịp chậm, có thể dùng dầu massage và điều chỉnh lực theo trao đổi trước buổi.',
    benefits: ['Thời lượng dài hơn cho vùng cổ gáy và lưng trên', 'Có thể chọn massage có dầu hoặc thao tác khô', 'Lực massage được điều chỉnh theo yêu cầu'],
    variants: [{ duration: 60, price: 470000 }, { duration: 75, price: 560000 }],
  },
  {
    id: 'herbal-foot-soak-massage',
    kind: 'therapy',
    therapyGroup: 'foot-massage',
    name: 'Ngâm Chân Thảo Mộc & Massage',
    category: 'focus-therapy',
    categoryName: 'Focus Therapy',
    imageId: 'therapy-foot-01',
    duration: 45,
    price: 320000,
    rating: 0,
    reviewsCount: 0,
    shortDesc: 'Ngâm chân nước ấm thảo mộc, tiếp nối bằng massage bàn chân và cổ chân.',
    fullDesc: 'Bắt đầu bằng bước ngâm chân trong nước ấm có thảo mộc, sau đó kỹ thuật viên lau khô và massage bàn chân, cổ chân với lực nhẹ đến vừa. Khách có thể báo nếu muốn rút ngắn hoặc bỏ bước ngâm.',
    benefits: ['Kết hợp ngâm chân và massage trong một buổi', 'Tập trung bàn chân, gót và cổ chân', 'Lựa chọn ngắn gọn trước hoặc sau ngày di chuyển'],
    variants: [{ duration: 45, price: 320000 }, { duration: 60, price: 390000 }],
  },
  {
    id: 'foot-reflexology',
    kind: 'therapy',
    therapyGroup: 'foot-massage',
    name: 'Bấm Huyệt Lòng Bàn Chân',
    category: 'focus-therapy',
    categoryName: 'Focus Therapy',
    imageId: 'therapy-foot-02',
    duration: 60,
    price: 420000,
    rating: 0,
    reviewsCount: 0,
    shortDesc: 'Massage bàn chân với các nhịp ấn theo vùng, kết hợp xoa bóp ngón chân và gan bàn chân.',
    fullDesc: 'Kỹ thuật viên lần lượt chăm sóc lòng bàn chân, gót và các ngón bằng những nhịp ấn có kiểm soát cùng động tác xoa bóp. Áp lực được điều chỉnh theo cảm giác của khách; liệu trình không thay thế tư vấn y tế.',
    benefits: ['Tập trung riêng vào bàn chân và các ngón', 'Có thể yêu cầu lực nhẹ hơn ở những vùng nhạy cảm', 'Phù hợp với khách muốn chọn massage chân độc lập'],
    variants: [{ duration: 45, price: 350000 }, { duration: 60, price: 420000 }, { duration: 75, price: 500000 }],
  },
  {
    id: 'warm-stone-foot-massage',
    kind: 'therapy',
    therapyGroup: 'foot-massage',
    name: 'Massage Chân Đá Ấm',
    category: 'focus-therapy',
    categoryName: 'Focus Therapy',
    imageId: 'therapy-foot-03',
    duration: 75,
    price: 520000,
    rating: 0,
    reviewsCount: 0,
    shortDesc: 'Massage bàn chân và bắp chân kết hợp đá ấm, nhiệt độ được thử trước trên da.',
    fullDesc: 'Buổi chăm sóc kết hợp massage chân bằng tay với đá ấm trên vùng bàn chân và bắp chân. Kỹ thuật viên thử nhiệt độ trước, tránh vùng da nhạy cảm và điều chỉnh hoặc dừng chườm khi khách yêu cầu.',
    benefits: ['Mở rộng thao tác từ bàn chân lên bắp chân', 'Kết hợp đá ấm với massage bằng tay', 'Nhiệt độ được kiểm tra và có thể điều chỉnh'],
    variants: [{ duration: 60, price: 450000 }, { duration: 75, price: 520000 }],
  },
  {
    id: 'heel-care-calf-massage',
    kind: 'therapy',
    therapyGroup: 'foot-massage',
    name: 'Chăm Sóc Gót Chân & Massage Bắp Chân',
    category: 'focus-therapy',
    categoryName: 'Focus Therapy',
    imageId: 'therapy-foot-04',
    duration: 60,
    price: 450000,
    rating: 0,
    reviewsCount: 0,
    shortDesc: 'Chăm sóc bề mặt gót chân nhẹ nhàng rồi massage bàn chân và bắp chân.',
    fullDesc: 'Liệu trình bắt đầu với bước làm mềm và chăm sóc bề mặt gót chân, sau đó massage bàn chân và bắp chân bằng dầu. Không bao gồm xử lý vết nứt sâu hoặc chăm sóc y khoa cho da chân.',
    benefits: ['Có bước chăm sóc gót chân bên cạnh massage', 'Bao gồm bàn chân và bắp chân', 'Thích hợp khi muốn kết hợp chăm sóc da chân với thư giãn'],
    variants: [{ duration: 60, price: 450000 }, { duration: 75, price: 530000 }],
  },
  {
    id: 'scalp-acupressure',
    kind: 'therapy',
    therapyGroup: 'head-face',
    name: 'Bấm Huyệt & Massage Da Đầu',
    category: 'hair-spa',
    categoryName: 'Others & Hair Wash',
    imageId: 'therapy-head-01',
    duration: 45,
    price: 350000,
    rating: 0,
    reviewsCount: 0,
    shortDesc: 'Một buổi massage khô tập trung da đầu, thái dương và vùng trán, không bao gồm gội.',
    fullDesc: 'Kỹ thuật viên thực hiện các nhịp day ấn nhẹ trên da đầu, thái dương và vùng trán bằng tay khô. Dịch vụ tách riêng phần massage, không bao gồm gội đầu hay chăm sóc da mặt.',
    benefits: ['Tách riêng massage da đầu khỏi dịch vụ gội', 'Không dùng dầu trên tóc', 'Có thể chọn lực chạm nhẹ nhàng'],
    variants: [{ duration: 30, price: 290000 }, { duration: 45, price: 350000 }],
  },
  {
    id: 'thai-head-massage',
    kind: 'therapy',
    therapyGroup: 'head-face',
    name: 'Massage Đầu Kiểu Thái',
    category: 'hair-spa',
    categoryName: 'Others & Hair Wash',
    imageId: 'therapy-head-02',
    duration: 45,
    price: 390000,
    rating: 0,
    reviewsCount: 0,
    shortDesc: 'Massage da đầu lấy cảm hứng từ kỹ thuật Thái, có sử dụng dụng cụ gõ gỗ nhẹ.',
    fullDesc: 'Kỹ thuật viên kết hợp thao tác bằng tay với dụng cụ gõ gỗ nhẹ trên các vùng da đầu phù hợp. Dụng cụ không dùng ở vùng mặt; lực và nhịp gõ được kiểm tra, điều chỉnh theo cảm nhận của khách.',
    benefits: ['Trải nghiệm kỹ thuật và dụng cụ khác với massage tay', 'Dụng cụ được dùng ở vùng da đầu theo trao đổi trước', 'Không bao gồm gội hoặc chăm sóc da mặt'],
    variants: [{ duration: 45, price: 390000 }, { duration: 60, price: 470000 }],
  },
  {
    id: 'gua-sha-face-neck',
    kind: 'therapy',
    therapyGroup: 'head-face',
    name: 'Massage Gua Sha Mặt & Cổ',
    category: 'hair-spa',
    categoryName: 'Others & Hair Wash',
    imageId: 'therapy-head-03',
    duration: 45,
    price: 420000,
    rating: 0,
    reviewsCount: 0,
    shortDesc: 'Massage nhẹ vùng mặt và cổ bằng dụng cụ gua sha, có lớp dầu hoặc gel phù hợp.',
    fullDesc: 'Sau bước làm sạch bề mặt da, kỹ thuật viên dùng dụng cụ gua sha với thao tác nhẹ trên vùng má, quai hàm và cổ. Không thực hiện trên vùng da đang kích ứng hoặc tổn thương; khách có thể chọn dừng bất kỳ lúc nào.',
    benefits: ['Dịch vụ tập trung vào thao tác massage bằng dụng cụ', 'Có bước làm sạch bề mặt da trước khi thực hiện', 'Không thay thế liệu trình chăm sóc da chuyên sâu'],
    variants: [{ duration: 45, price: 420000 }, { duration: 60, price: 500000 }],
  },
  {
    id: 'temple-eye-relax',
    kind: 'therapy',
    therapyGroup: 'head-face',
    name: 'Massage Thái Dương & Vùng Mắt',
    category: 'hair-spa',
    categoryName: 'Others & Hair Wash',
    imageId: 'therapy-head-04',
    duration: 30,
    price: 300000,
    rating: 0,
    reviewsCount: 0,
    shortDesc: 'Massage chạm nhẹ quanh thái dương, trán và viền hốc mắt, không ấn trực tiếp lên nhãn cầu.',
    fullDesc: 'Liệu trình ngắn tập trung vào thái dương, trán và vùng xương quanh hốc mắt bằng thao tác chạm nhẹ. Kỹ thuật viên tránh nhãn cầu và vùng da đang nhạy cảm; khách có thể yêu cầu bỏ qua bất kỳ khu vực nào.',
    benefits: ['Thời lượng ngắn, tập trung một vùng nhỏ', 'Thao tác nhẹ quanh vùng xương mắt và thái dương', 'Có thể bỏ qua vùng khách không muốn chạm'],
    variants: [{ duration: 30, price: 300000 }, { duration: 45, price: 360000 }],
  },
]);

export const ADDITIONAL_THERAPY_SEED_IDS = Object.freeze(ADDITIONAL_THERAPY_SEEDS.map(({ id }) => id));

/** Dữ liệu dịch vụ mẫu (chỉ dùng để seed lần đầu, KHÔNG được import trực tiếp bởi UI). */
export const SERVICES_SEED = [
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
    kind: 'package',
    components: ['foot-head-neck', 'hot-stone', 'herbal-hair-wash'],
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
    kind: 'package',
    components: ['body-scrub-bath', 'four-hands', 'facial-dermalogica'],
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
    id: 'moc-tam-duong-sinh',
    kind: 'package',
    components: ['signature-body', 'herbal-hair-wash'],
    name: 'Mộc Tâm & Dưỡng Sinh',
    category: 'packages',
    categoryName: 'Spa Packages',
    imageId: 'pkg-moc-tam-01',
    duration: 150,
    price: 920000,
    rating: 0,
    reviewsCount: 0,
    shortDesc: 'Massage toàn thân kết hợp gội đầu dưỡng sinh thảo dược trong một gói 150 phút.',
    fullDesc: 'Một buổi chăm sóc nối tiếp giữa massage toàn thân và gội đầu dưỡng sinh thảo dược. Gói được thiết kế cho khách muốn dành trọn một khoảng thời gian thư giãn tại Serenity.',
    benefits: [
      'Kết hợp massage toàn thân và chăm sóc da đầu trong cùng một lần đặt lịch',
      'Thời lượng dài để tận hưởng hai liệu trình nối tiếp',
      'Đặt một lịch liên tục với một chuyên viên'
    ],
    variants: [
      { duration: 150, price: 920000 }
    ]
  },
  {
    id: 'lam-moi-tha-long',
    kind: 'package',
    components: ['body-scrub-bath', 'aroma-therapy'],
    name: 'Làm Mới & Thả Lỏng',
    category: 'packages',
    categoryName: 'Spa Packages',
    imageId: 'pkg-lam-moi-01',
    duration: 150,
    price: 990000,
    rating: 0,
    reviewsCount: 0,
    shortDesc: 'Tẩy tế bào chết toàn thân kết hợp massage tinh dầu trong gói 150 phút.',
    fullDesc: 'Bắt đầu với liệu trình tẩy tế bào chết muối hồng Himalayan và tiếp nối bằng massage Aroma. Một lựa chọn chăm sóc cơ thể kết hợp thư giãn trong một lịch hẹn liên tục.',
    benefits: [
      'Kết hợp chăm sóc da cơ thể và massage tinh dầu',
      'Các bước được sắp xếp nối tiếp trong một lần ghé spa',
      'Đặt một lịch liên tục với một chuyên viên'
    ],
    variants: [
      { duration: 150, price: 990000 }
    ]
  },
  {
    id: 'deo-dai-nhe-chan',
    kind: 'package',
    components: ['thai-massage', 'foot-head-neck'],
    name: 'Dẻo Dai, Nhẹ Chân',
    category: 'packages',
    categoryName: 'Spa Packages',
    imageId: 'thai-stretch-01',
    duration: 150,
    price: 990000,
    rating: 0,
    reviewsCount: 0,
    shortDesc: 'Massage Thái kết hợp chăm sóc bàn chân, đầu và cổ-vai-gáy trong gói 150 phút.',
    fullDesc: 'Kết hợp các động tác kéo giãn trong massage Thái với liệu trình chăm sóc bàn chân và vùng đầu, cổ, vai. Hai phần được thực hiện nối tiếp trong một buổi chăm sóc.',
    benefits: [
      'Kết hợp massage toàn thân và chăm sóc các vùng chân, đầu, cổ-vai-gáy',
      'Phù hợp khi muốn dành thời gian cho một liệu trình dài',
      'Đặt một lịch liên tục với một chuyên viên'
    ],
    variants: [
      { duration: 150, price: 990000 }
    ]
  },
  {
    id: 'am-da-sang-da',
    kind: 'package',
    components: ['hot-stone', 'facial-dermalogica'],
    name: 'Ấm Đá & Sáng Da',
    category: 'packages',
    categoryName: 'Spa Packages',
    imageId: 'pkg-am-da-01',
    duration: 180,
    price: 1290000,
    rating: 0,
    reviewsCount: 0,
    shortDesc: 'Massage đá nóng kết hợp chăm sóc da mặt trong gói 180 phút.',
    fullDesc: 'Một hành trình chăm sóc nối tiếp giữa massage đá nóng và liệu trình chăm sóc da mặt Dermalogica. Gói dành cho khách muốn kết hợp thư giãn cơ thể với chăm sóc da trong cùng một lần đặt lịch.',
    benefits: [
      'Kết hợp massage đá nóng với chăm sóc da mặt',
      'Hai liệu trình được đặt trong cùng một buổi',
      'Đặt một lịch liên tục với một chuyên viên'
    ],
    variants: [
      { duration: 180, price: 1290000 }
    ]
  },
  {
    id: 'goi-thao-moc-cham-da',
    kind: 'package',
    components: ['herbal-hair-wash', 'facial-dermalogica'],
    name: 'Gội Thảo Mộc & Chăm Da',
    category: 'packages',
    categoryName: 'Spa Packages',
    imageId: 'pkg-goi-thao-moc-01',
    duration: 135,
    price: 920000,
    rating: 0,
    reviewsCount: 0,
    shortDesc: 'Gội đầu dưỡng sinh thảo dược kết hợp chăm sóc da mặt trong gói 135 phút.',
    fullDesc: 'Kết hợp gội đầu dưỡng sinh thảo dược với liệu trình chăm sóc da mặt Dermalogica. Gói tạo lựa chọn chăm sóc da đầu và da mặt trong một lịch hẹn liên tục.',
    benefits: [
      'Kết hợp chăm sóc da đầu thảo dược và da mặt',
      'Thực hiện hai liệu trình nối tiếp trong cùng một buổi',
      'Đặt một lịch liên tục với một chuyên viên'
    ],
    variants: [
      { duration: 135, price: 920000 }
    ]
  },
  ...ADDITIONAL_THERAPY_SEEDS,
];
