// @ts-nocheck
import * as THREE from "three";

let activeStop = null;

export function startTheon() {
  if (activeStop) {
    const prev = activeStop;
    activeStop = null;
    prev();
  }

  const abort = new AbortController();
  const signal = abort.signal;
  let rafId = 0;
  let running = true;

    /* =========================================================================
1. HẰNG SỐ KHÔNG GIAN HỘP ÂM & TRẠNG THÁI ỨNG DỤNG
       ========================================================================= */
    const SCREEN_H = 10.0;        // Chiều cao mặt kính z = 0
    const BOX_DEPTH = 6.2;        // Chiều sâu hộp 3D âm
    const CAM_Z = 14.5;           // Khoảng cách camera Off-Axis
    const CAM_NEAR = 0.2;
    const CAM_FAR = 60.0;
    const HEAD_BASE_POS = new THREE.Vector3(0.0, 0.10, -3.10);
    const MATRIX_DURATION = 3.5;  // Thời lượng chuỗi kết tinh Theon
    const MAX_DYNAMIC_OBJECTS = 10;

    // 7 biểu cảm khuôn mặt chuẩn xác trên các mảng phẳng Asaro
    const EXPRESSION_META = {
      friendly:   { label: 'Thân thiện', tag: 'THÂN THIỆN' },
      focused:    { label: 'Tập trung',  tag: 'TẬP TRUNG' },
      thoughtful: { label: 'Suy tư',     tag: 'SUY TƯ' },
      surprised:  { label: 'Ngạc nhiên', tag: 'NGẠC NHIÊN' },
      happy:      { label: 'Vui vẻ',     tag: 'VUI VẺ' },
      serious:    { label: 'Nghiêm túc', tag: 'NGHIÊM TÚC' },
      relaxed:    { label: 'Thư giãn',   tag: 'THƯ GIÃN' }
    };

    const EXPRESSION_PRESETS = {
      friendly: {
        browRaiseL: 0.14, browRaiseR: 0.14, browFurrow: 0.0,
        lidUpper: 0.10, lidLower: 0.18, cheekLift: 0.30,
        smile: 0.52, mouthOpen: 0.0, mouthPress: 0.0, mouthAsym: 0.0, jawDrop: 0.0,
        headPitchAdd: 0.0, headRollAdd: 0.012, headZAdd: 0.0
      },
      focused: {
        browRaiseL: -0.36, browRaiseR: -0.36, browFurrow: 0.85,
        lidUpper: -0.26, lidLower: 0.22, cheekLift: 0.04,
        smile: -0.05, mouthOpen: 0.0, mouthPress: 0.65, mouthAsym: 0.0, jawDrop: 0.0,
        headPitchAdd: 0.045, headRollAdd: 0.0, headZAdd: 0.15
      },
      thoughtful: {
        browRaiseL: 0.68, browRaiseR: -0.20, browFurrow: 0.28,
        lidUpper: 0.12, lidLower: 0.08, cheekLift: 0.08,
        smile: 0.08, mouthOpen: 0.0, mouthPress: 0.32, mouthAsym: 0.85, jawDrop: 0.0,
        headPitchAdd: -0.02, headRollAdd: 0.14, headZAdd: 0.05
      },
      surprised: {
        browRaiseL: 0.94, browRaiseR: 0.94, browFurrow: 0.0,
        lidUpper: 0.62, lidLower: -0.20, cheekLift: 0.04,
        smile: -0.08, mouthOpen: 0.85, mouthPress: 0.0, mouthAsym: 0.0, jawDrop: 0.62,
        headPitchAdd: -0.045, headRollAdd: 0.0, headZAdd: 0.16
      },
      happy: {
        browRaiseL: 0.34, browRaiseR: 0.34, browFurrow: 0.0,
        lidUpper: -0.05, lidLower: 0.68, cheekLift: 0.96,
        smile: 1.0, mouthOpen: 0.24, mouthPress: 0.0, mouthAsym: 0.0, jawDrop: 0.14,
        headPitchAdd: -0.012, headRollAdd: -0.032, headZAdd: 0.08
      },
      serious: {
        browRaiseL: -0.58, browRaiseR: -0.58, browFurrow: 0.62,
        lidUpper: -0.20, lidLower: 0.12, cheekLift: 0.0,
        smile: -0.22, mouthOpen: 0.0, mouthPress: 0.92, mouthAsym: 0.0, jawDrop: 0.0,
        headPitchAdd: 0.02, headRollAdd: 0.0, headZAdd: -0.04
      },
      relaxed: {
        browRaiseL: -0.06, browRaiseR: -0.06, browFurrow: 0.0,
        lidUpper: -0.50, lidLower: 0.15, cheekLift: 0.14,
        smile: 0.26, mouthOpen: 0.0, mouthPress: 0.0, mouthAsym: 0.0, jawDrop: 0.0,
        headPitchAdd: 0.028, headRollAdd: -0.02, headZAdd: -0.08
      }
    };

    const EXPR_KEYS = Object.keys(EXPRESSION_PRESETS.friendly);

    const state = {
      mode: 'reading',           // 'reading' | 'mouse'
      headStyle: 'planar',       // 'planar' | 'sculpture' | 'translucent' | 'triwire'
      autoExpression: true,
      currentExpr: 'friendly',
      bgMatrixRain: true,
      parallaxEnabled: true,
      autoSpawnEnabled: false,
      autoSpawnTimer: 6.0,
      closeUpMode: false,
      closeUpT: 0.0,
      edgeBrightness: 0.72,
      readSpeed: 1.0,
      hudVisible: true,
      captionVisible: true,

      // Đồ thị 3D ghim cố định ngay trước mặt Theon
      graphVisible: false,
      graphMode: 'wave',         // 'wave' | 'bars' | 'orbit'

      screenW: 16.0,
      screenH: SCREEN_H,
      pointerX: 0,
      pointerY: 0,
      eyeCamX: 0,
      eyeCamY: 0,

      exprCur: { ...EXPRESSION_PRESETS.friendly },

      // Chuỗi tái tạo ma trận chữ dọc cho Theon
      matrixActive: true,
      matrixTime: 0.0,
      revealY: 3.1,
      awakeningEyes: 0.0,
      initialDemoSpawned: false,

      // Chuyển động đầu & mắt
      headYaw: 0,
      headPitch: 0,
      headRoll: 0,
      leftEyeYaw: 0,
      leftEyePitch: 0,
      rightEyeYaw: 0,
      rightEyePitch: 0,

      // Chớp mắt & gật đầu tự nhiên
      blinkVal: 0,
      blinkPhase: 0,
      blinkTimer: 2.9,
      blinkDuration: 0.14,
      doubleBlinkPending: false,
      nodPhase: 0,
      nodStrength: 0,

      // Bộ đọc màn hình tài liệu ảo
      activeDocIndex: 0,
      docTitle: '',
      docLines: [],
      lineIndex: 0,
      chunkIndex: 0,
      fixationTimer: 0.42,
      scrollOffset: 0.0,
      targetScrollOffset: 0.0,
      gazeDocU: 0.18,
      gazeDocV: 0.30,
      targetGazeDocU: 0.18,
      targetGazeDocV: 0.30,
      screenLightPulse: 0.0,
      screenCanvasDirty: true
    };

    /* =========================================================================
2. 3 BỘ TÀI LIỆU MẪU TIẾNG VIỆT & KỸ THUẬT CHO THEON ĐỌC
       ========================================================================= */
    const SAMPLE_DOCUMENTS = [
      {
        title: 'THEON_ARCH.md // KIẾN TRÚC NHẬN THỨC',
        body: `Xin chào! Mình là Theon, tượng điêu khắc mảng phẳng Asaro sứ trắng đặt trong không gian khung xanh lam sâu thẳm.
Mỗi mảng phẳng trên trán, cung mày, sống mũi và dải gò má đều được phân định rõ ràng để đón ánh sáng studio sắc nét.
Bạn có thấy những dòng chữ xanh lam sáng này đang phản chiếu trực tiếp trên bề mặt giác mạc kính của mình không?
Thật thú vị! Bạn có thể bấm phím 1 hoặc 2 để triệu hồi khối sách và thẻ ghi chú từ ma trận chữ rơi ngay trong hộp này!
Đôi khi mình tự hỏi: Khi một cuốn sách trôi rớt xuống sàn đen, bạn có muốn nhặt nó lên để mình cùng đọc tiếp không?
Kiểm tra hệ trục chiếu lệch tâm Off-Axis Projection tại mặt kính z = 0.00 và chiều sâu hộp BOX_DEPTH = 6.20.
Lưu ý nghiêm túc: Hãy bấm phím 3 để bật đồ thị 3D ghim cố định ngay trước tầm nhìn phân tích của mình.
Cảm ơn bạn đã trò chuyện cùng Theon! Thật vui khi được đồng hành và hỗ trợ các ý tưởng sáng tạo của bạn.`
      },
      {
        title: 'CRYPTO_ALGO.ts // MẬT MÃ & THUẬT TOÁN',
        body: `// Khởi chạy trình phân tích cấu trúc Theon Planar Engine v5.0
const hash = sha256(seedMatrix) => verifyIntegrity(blockHeader);
Đang quét cấu trúc mảng phẳng đối xứng gương qua trục X = 0 với độ chính xác hình học cao...
Kết quả tối ưu hóa thật ấn tượng! Tốc độ biến dạng biểu cảm và vật lý rơi đạt ổn định 60 khung hình/giây!
Liệu hệ thống Raycaster có thể bắt chính xác thẻ ghi chú kể cả khi đang lơ lửng hay đã hạ cánh trên nền hộp chưa?
Phân tích điểm hội tụ ánh nhìn hai mắt (binocular convergence) hướng về vật thể người dùng đang cầm kéo.
Cảnh báo bảo mật: Mọi khóa phiên và luồng văn bản đầu vào cần được kiểm chứng chặt chẽ trước khi thực thi.
Hoàn tất chu trình kiểm định thuật toán. Chuyển sang trạng thái thư giãn nhẹ nhàng và sẵn sàng nhận yêu cầu tiếp theo.`
      },
      {
        title: 'PROJECT_LOG.txt // GHI CHÚ DỰ ÁN',
        body: `Ghi chú phiên làm việc: Không gian của Theon đã chuyển sang nền đen thuần viền xanh lam đóng khung tối giản!
Tượng đầu sứ trắng ánh lam nổi bật sắc nét kết hợp đôi mắt tròng trắng có đổ bóng cầu và mí mắt phẳng Asaro.
Khi bạn di chuyển chuột quanh màn hình, chiếc hộp 3D âm phía sau khẽ nghiêng tạo hiệu ứng chiều sâu thật sống động!
Bạn có muốn thử kéo một cuốn sách qua lại trước mặt Theon để xem ánh mắt mình dõi theo nó không?
Mình rất vui khi được lắng nghe ý kiến tinh chỉnh của bạn để hoàn thiện không gian tương tác ngày càng cuốn hút!
Cần lưu ý: Hãy nghỉ mắt vài phút sau mỗi giờ làm việc tập trung bên máy tính để giữ tinh thần luôn minh mẫn.
Mọi thông số đều đã sẵn sàng và ổn định... Mình luôn ở ngay đây trong chiếc hộp khung xanh lam này chờ lệnh của bạn.`
      }
    ];

    const BOOK_CATALOG = [
      { title: 'ASARO PLANAR',  sub: 'VOL. 01 · GEOMETRY', code: 'ISBN-01-ASARO', accent: '#3b82f6' },
      { title: 'LINEAR MATRIX', sub: 'VOL. 02 · ALGEBRA',  code: 'ISBN-02-MATRX', accent: '#2563eb' },
      { title: 'OPTICS & GAZE', sub: 'VOL. 03 · CORNEA',   code: 'ISBN-03-OPTIC', accent: '#60a5fa' },
      { title: 'NEURAL NOTES',  sub: 'VOL. 04 · COGNITION',code: 'ISBN-04-NEURL', accent: '#1d4ed8' }
    ];

    const FALLBACK_NOTES = [
      { tag: 'NOTE // 01', body: 'Off-Axis Projection ghim khít mặt phẳng z = 0 vào 4 mép khung hình trình duyệt.' },
      { tag: 'NOTE // 02', body: 'Pháp tuyến flatShading tôn rõ 148 mảng phẳng giải phẫu đối xứng qua trục X = 0.' },
      { tag: 'NOTE // 03', body: 'Sách và thẻ sẽ tự động mất lực nâng và trôi rớt xuống nền sau khoảng 25 giây.' },
      { tag: 'NOTE // 04', body: 'Bạn có thể nhặt và kéo bất kỳ cuốn sách hay thẻ nào ngay cả khi đã nằm trên sàn.' },
      { tag: 'NOTE // 05', body: 'Bấm phím [3] để bật đồ thị 3D ghim cố định ngay trước mặt Theon.' }
    ];

    /* =========================================================================
3. BIẾN TOÀN CỤC THREE.JS & HÀM TOÁN HỌC
       ========================================================================= */
    let scene, camera, renderer;
    let chamberGroup, wallMeshes = {}, chamberEdgeLines;
    let headFloatGroup, headRig;
    let headSolidMesh, headPlanarEdgeMesh, headTriWireMesh, mouthInnerMesh;
    let earGroup;
    const earObjects = [];
    let leftEyeObj, rightEyeObj;
    let hemiLight, keyLight, rimLight, screenFaceLight;

    let virtualScreenCanvas, virtualScreenCtx, virtualScreenTexture;
    let glyphAtlasTexture;
    let emergenceSystem = null;
    let bgRainSystem = null;
    let asaroData = null;

    // Hệ thống vật thể 3D sinh từ Ma trận + Nhặt & Kéo (Raycaster)
    let dynamicObjectsGroup;
    const dynamicObjects = [];   // Books & Note Cards
    const matrixBursts = [];     // Cụm hạt ký tự cục bộ khi sinh vật thể
    let pinnedGraphObj = null;
    let bookCycleIdx = 0;
    let noteCycleIdx = 0;

    const raycaster = new THREE.Raycaster();
    const pointerNDC = new THREE.Vector2();
    const dragPlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 2.0);
    const dragIntersect = new THREE.Vector3();
    const dragOffset = new THREE.Vector3();
    let hoveredObj = null;
    let draggedObj = null;

    const clock = new THREE.Clock();
    const tempTargetWorld = new THREE.Vector3();
    const tempEyeWorld = new THREE.Vector3();
    const tempObjWorld = new THREE.Vector3();

    // Uniforms dùng chung cho 5 vách hộp 3D âm nền đen viền xanh lam
    const wallBoxUniforms = {
      uBoxWidth: { value: 16.0 },
      uBoxHeight: { value: SCREEN_H },
      uBoxDepth: { value: BOX_DEPTH },
      uHeadXZ: { value: new THREE.Vector2(HEAD_BASE_POS.x, HEAD_BASE_POS.z) },
      uHeadFloat: { value: 0.0 },
      uRevealGlow: { value: 0.0 }
    };

    // Uniforms quét kết tinh Ma trận cho Theon
    const headMatrixUniforms = {
      uRevealY: { value: 3.1 },
      uMatrixActive: { value: 1.0 },
      uScanColor: { value: new THREE.Color('#60a5fa') }
    };

    const planarEdgeUniforms = {
      uColor: { value: new THREE.Color('#1d4ed8') },
      uEdgeMint: { value: new THREE.Color('#60a5fa') },
      uOpacity: { value: 0.72 },
      uBackFade: { value: 0.16 },
      uWireOnly: { value: 0.0 },
      uRevealY: headMatrixUniforms.uRevealY,
      uMatrixActive: headMatrixUniforms.uMatrixActive
    };

    function lerp(a, b, t) {
      return a + (b - a) * t;
    }

    function clamp(v, min, max) {
      return Math.max(min, Math.min(max, v));
    }

    function smoothstep(e0, e1, x) {
      const t = clamp((x - e0) / (e1 - e0), 0, 1);
      return t * t * (3 - 2 * t);
    }

    /* =========================================================================
4. PHÉP CHIẾU OFF-AXIS & HỘP CHỮ NHẬT 3D ÂM NỀN ĐEN VIỀN XANH LAM
       ========================================================================= */
    function updateCameraProjection(ex, ey) {
      const aspect = state.screenW / state.screenH;
      const zt = smoothstep(0, 1, state.closeUpT);

      const headScale = headFloatGroup ? headFloatGroup.scale.x : 1.0;
      const eyeWorldY = HEAD_BASE_POS.y + 0.22 * headScale;
      const eyePlaneZ = HEAD_BASE_POS.z + 1.66 * headScale;

      const zPlane = lerp(0.0, eyePlaneZ, zt);
      const camZ   = lerp(CAM_Z, eyePlaneZ + 3.45, zt);
      const dist   = Math.max(0.8, camZ - zPlane);

      const closeHalfH = aspect < 0.85 ? 1.62 : 1.18;
      const halfH = lerp(state.screenH * 0.5, closeHalfH, zt);
      const halfW = halfH * aspect;

      const centerX = 0.0;
      const centerY = lerp(0.0, eyeWorldY, zt);

      const camX = ex * lerp(1.0, 0.20, zt);
      const camY = centerY + ey * lerp(1.0, 0.16, zt);

      camera.position.set(camX, camY, camZ);
      camera.quaternion.identity();

      const scale = CAM_NEAR / dist;
      const left   = (centerX - halfW - camX) * scale;
      const right  = (centerX + halfW - camX) * scale;
      const bottom = (centerY - halfH - camY) * scale;
      const top    = (centerY + halfH - camY) * scale;

      camera.projectionMatrix.makePerspective(left, right, top, bottom, CAM_NEAR, CAM_FAR);
      camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
    }

    /**
- Shader 5 vách hộp nền đen thuần (#02050b) có ánh phản xạ viền xanh lam cực nhẹ
- và vệt bóng mờ tinh tế trên sàn dưới đầu Theon.
     */
    function createBlackFramedWallMaterial() {
      return new THREE.ShaderMaterial({
        uniforms: wallBoxUniforms,
        side: THREE.FrontSide,
        vertexShader: `
          varying vec3 vWorldPos;
          varying vec3 vWorldNormal;
          void main() {
            vec4 wp = modelMatrix * vec4(position, 1.0);
            vWorldPos = wp.xyz;
            vWorldNormal = normalize(mat3(modelMatrix) * normal);
            gl_Position = projectionMatrix * viewMatrix * wp;
          }
        `,
        fragmentShader: `
          uniform float uBoxWidth;
          uniform float uBoxHeight;
          uniform float uBoxDepth;
          uniform vec2 uHeadXZ;
          uniform float uHeadFloat;
          uniform float uRevealGlow;

          varying vec3 vWorldPos;
          varying vec3 vWorldNormal;

          void main() {
            vec3 absN = abs(vWorldNormal);
            float hw = uBoxWidth * 0.5;
            float hh = uBoxHeight * 0.5;

            // Nền đen thuần sâu thẳm (#02050b)
            vec3 baseBlack = vec3(0.008, 0.018, 0.040);

            // Viền hắt sáng xanh lam mảnh dọc theo các góc đóng khung của hộp
            float dX = hw - abs(vWorldPos.x);
            float dY = hh - abs(vWorldPos.y);
            float dBack = vWorldPos.z + uBoxDepth;
            float dFront = -vWorldPos.z;

            float edgeDist = 10.0;
            if (absN.z > 0.5) {
              edgeDist = min(dX, dY);
            } else if (absN.x > 0.5) {
              edgeDist = min(min(dY, dBack), dFront);
            } else {
              edgeDist = min(min(dX, dBack), dFront);
            }

            float rimGlow = exp(-edgeDist * 5.2) * (0.14 + uRevealGlow * 0.10);
            vec3 color = baseBlack + vec3(0.14, 0.38, 0.92) * rimGlow;

            // Vệt bóng mờ cực nhẹ trên sàn ngay dưới khối đầu lơ lửng của Theon
            if (vWorldNormal.y > 0.5) {
              float dist = length(vWorldPos.xz - uHeadXZ);
              float halo = exp(-pow(dist / (2.75 + uHeadFloat * 0.9), 2.0));
              float coreShadow = exp(-pow(dist / 1.55, 2.0));
              color += vec3(0.05, 0.14, 0.34) * halo * 0.22;
              color *= (1.0 - coreShadow * 0.55);
            }

            gl_FragColor = vec4(color, 1.0);
          }
        `
      });
    }

    function buildRecessedBox() {
      chamberGroup = new THREE.Group();
      scene.add(chamberGroup);

      const wallMat = createBlackFramedWallMaterial();
      const unitPlane = new THREE.PlaneGeometry(1, 1);

      wallMeshes.back   = new THREE.Mesh(unitPlane, wallMat);
      wallMeshes.left   = new THREE.Mesh(unitPlane, wallMat);
      wallMeshes.right  = new THREE.Mesh(unitPlane, wallMat);
      wallMeshes.top    = new THREE.Mesh(unitPlane, wallMat);
      wallMeshes.bottom = new THREE.Mesh(unitPlane, wallMat);

      wallMeshes.left.rotation.y   =  Math.PI / 2;
      wallMeshes.right.rotation.y  = -Math.PI / 2;
      wallMeshes.top.rotation.x    =  Math.PI / 2;
      wallMeshes.bottom.rotation.x = -Math.PI / 2;

      chamberGroup.add(
        wallMeshes.back,
        wallMeshes.left,
        wallMeshes.right,
        wallMeshes.top,
        wallMeshes.bottom
      );

      // 12 cạnh đóng khung xanh lam sắc nét (4 cạnh chiều sâu + 4 cạnh mặt sau + 4 cạnh mặt trước)
      const edgeGeo = new THREE.BufferGeometry();
      edgeGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(12 * 2 * 3), 3));
      chamberEdgeLines = new THREE.LineSegments(
        edgeGeo,
        new THREE.LineBasicMaterial({
          color: '#3b82f6',
          transparent: true,
          opacity: 0.85
        })
      );
      chamberGroup.add(chamberEdgeLines);

      rebuildBoxDimensions();
    }

    function rebuildBoxDimensions() {
      const aspect = window.innerWidth / Math.max(window.innerHeight, 1);
      state.screenH = SCREEN_H;
      state.screenW = SCREEN_H * aspect;

      const hw = state.screenW * 0.5;
      const hh = state.screenH * 0.5;
      const d  = BOX_DEPTH;

      wallBoxUniforms.uBoxWidth.value = state.screenW;

      wallMeshes.back.scale.set(state.screenW, state.screenH, 1);
      wallMeshes.back.position.set(0, 0, -d);

      wallMeshes.left.scale.set(d, state.screenH, 1);
      wallMeshes.left.position.set(-hw, 0, -d * 0.5);

      wallMeshes.right.scale.set(d, state.screenH, 1);
      wallMeshes.right.position.set(hw, 0, -d * 0.5);

      wallMeshes.top.scale.set(state.screenW, d, 1);
      wallMeshes.top.position.set(0, hh, -d * 0.5);

      wallMeshes.bottom.scale.set(state.screenW, d, 1);
      wallMeshes.bottom.position.set(0, -hh, -d * 0.5);

      const eps = 0.012;
      const xL = -hw + eps, xR = hw - eps;
      const yB = -hh + eps, yT = hh - eps;
      const zF = -0.02, zB = -d + eps;

      const segs = [
        // 4 cạnh chiều sâu
        xL, yT, zF,  xL, yT, zB,
        xR, yT, zF,  xR, yT, zB,
        xL, yB, zF,  xL, yB, zB,
        xR, yB, zF,  xR, yB, zB,
        // 4 cạnh khung mặt sau
        xL, yT, zB,  xR, yT, zB,
        xR, yT, zB,  xR, yB, zB,
        xR, yB, zB,  xL, yB, zB,
        xL, yB, zB,  xL, yT, zB,
        // 4 cạnh khung mặt trước
        xL, yT, zF,  xR, yT, zF,
        xR, yT, zF,  xR, yB, zF,
        xR, yB, zF,  xL, yB, zF,
        xL, yB, zF,  xL, yT, zF
      ];
      const posAttr = chamberEdgeLines.geometry.attributes.position;
      posAttr.array.set(segs);
      posAttr.needsUpdate = true;

      if (headFloatGroup) {
        const widthFit = (state.screenW * 0.50) / 3.9;
        const headScale = clamp(Math.min(1.02, widthFit), 0.62, 1.02);
        headFloatGroup.scale.setScalar(headScale);
      }

      if (pinnedGraphObj) {
        const gScale = clamp(state.screenW / 14.5, 0.62, 1.05);
        pinnedGraphObj.group.scale.setScalar(gScale);
      }

      if (bgRainSystem) {
        bgRainSystem.relayout(state.screenW, state.screenH);
      }

      updateCameraProjection(state.eyeCamX, state.eyeCamY);
    }

    /* =========================================================================
5. MÀN HÌNH ĐỌC ẢO 512×512 PHẢN CHIẾU TRÊN GIÁC MẠC KÍNH THEON
       ========================================================================= */
    function detectExpressionFromText(text, isEndOfPara) {
      const lower = text.toLowerCase();
      if (/\?/.test(text) || /(liệu|tự hỏi|tại sao|có muốn|có thấy|có thể)/.test(lower)) {
        return 'thoughtful';
      }
      if (/!/.test(text) && /(vui|chào|cảm ơn|tuyệt|ấn tượng|cuốn hút)/.test(lower)) {
        return 'happy';
      }
      if (/!/.test(text) || /(thú vị|sống động|bất ngờ|triệu hồi)/.test(lower)) {
        return 'surprised';
      }
      if (/(cảnh báo|nghiêm túc|bảo mật|lưu ý|tuyệt đối|kiểm chứng)/.test(lower)) {
        return 'serious';
      }
      if (/(const |=>|sha256|box_depth|raycaster|thuật toán|phân tích|kiểm tra|kiểm định|off-axis|\/\/)/.test(lower)) {
        return 'focused';
      }
      if (/(thư giãn|nhẹ nhàng|êm dịu|nghỉ mắt|ổn định|chờ lệnh)/.test(lower)) {
        return 'relaxed';
      }
      if (/(chào|thân thiện|vui|cảm ơn|đồng hành|ấm áp)/.test(lower)) {
        return 'friendly';
      }
      return isEndOfPara ? 'friendly' : 'focused';
    }

    function loadVirtualDocument(title, rawBody) {
      state.docTitle = title || 'THEON_READER.txt';
      state.docRawBody = rawBody;
      virtualScreenCtx.font = '600 22px "JetBrains Mono", ui-monospace, monospace';
      const maxW = 414;
      const startX = 68;

      const rawParas = rawBody.trim().split(/\n+/).map((p) => p.trim()).filter(Boolean);
      const parsedLines = [];

      rawParas.forEach((para) => {
        const words = para.split(/\s+/).filter(Boolean);
        const paraLines = [];
        let cur = '';
        for (let i = 0; i < words.length; i++) {
          const test = cur ? `${cur} ${words[i]}` : words[i];
          if (virtualScreenCtx.measureText(test).width <= maxW || !cur) {
            cur = test;
          } else {
            paraLines.push(cur);
            cur = words[i];
          }
        }
        if (cur) paraLines.push(cur);

        paraLines.forEach((lineStr, lIdx) => {
          const isEndOfPara = lIdx === paraLines.length - 1;
          const lineExpr = detectExpressionFromText(para, isEndOfPara);
          const lWords = lineStr.split(' ');
          const chunks = [];
          let cx = startX;
          let buf = [];

          for (let w = 0; w < lWords.length; w++) {
            buf.push(lWords[w]);
            const seg = buf.join(' ');
            const isLast = w === lWords.length - 1;
            if (isLast || buf.length >= 2 || virtualScreenCtx.measureText(seg).width >= 135) {
              const segW = virtualScreenCtx.measureText(seg).width;
              const spW = isLast ? 0 : virtualScreenCtx.measureText(' ').width;
              chunks.push({
                text: seg,
                x0: cx,
                x1: cx + segW,
                cx: cx + segW * 0.5,
                exprHint: detectExpressionFromText(seg, isLast && isEndOfPara) || lineExpr
              });
              cx += segW + spW;
              buf = [];
            }
          }

          parsedLines.push({
            text: lineStr,
            chunks,
            lineExpr,
            endOfPara: isEndOfPara
          });
        });
      });

      if (parsedLines.length === 0) {
        parsedLines.push({
          text: 'THEON PLANAR // READY',
          chunks: [{ text: 'THEON PLANAR', x0: startX, x1: 260, cx: 164, exprHint: 'friendly' }],
          lineExpr: 'friendly',
          endOfPara: true
        });
      }

      state.docLines = parsedLines;
      state.lineIndex = 0;
      state.chunkIndex = 0;
      state.scrollOffset = 0;
      state.targetScrollOffset = 0;
      state.fixationTimer = 0.42;
      state.screenCanvasDirty = true;

      const firstChunk = parsedLines[0].chunks[0];
      state.targetGazeDocU = firstChunk.cx / 512;
      state.targetGazeDocV = 0.24;
      state.gazeDocU = state.targetGazeDocU;
      state.gazeDocV = state.targetGazeDocV;

      updateCaptionDisplay();
      renderVirtualScreenCanvas();
    }

    function renderVirtualScreenCanvas() {
      if (!virtualScreenCtx) return;
      const ctx = virtualScreenCtx;
      const W = 512;
      const H = 512;

      ctx.fillStyle = '#040c1a';
      ctx.fillRect(0, 0, W, H);

      ctx.strokeStyle = 'rgba(147, 197, 253, 0.78)';
      ctx.lineWidth = 4;
      ctx.strokeRect(4, 4, W - 8, H - 8);

      ctx.fillStyle = '#0b1e3d';
      ctx.fillRect(6, 6, W - 12, 42);
      ['#60a5fa', '#3b82f6', '#93c5fd'].forEach((col, i) => {
        ctx.fillStyle = col;
        ctx.beginPath();
        ctx.arc(26 + i * 16, 27, 4.5, 0, Math.PI * 2);
        ctx.fill();
      });

      ctx.font = '600 15px "JetBrains Mono", ui-monospace, monospace';
      ctx.fillStyle = '#bfdbfe';
      ctx.fillText(state.docTitle.slice(0, 32), 78, 32);
      ctx.fillStyle = '#3b82f6';
      ctx.fillRect(6, 48, W - 12, 2);

      ctx.save();
      ctx.beginPath();
      ctx.rect(8, 54, W - 16, H - 82);
      ctx.clip();

      const lineH = 44;
      const baseTopY = 92;
      const scrollPx = state.scrollOffset * lineH;

      ctx.fillStyle = 'rgba(37, 99, 235, 0.15)';
      ctx.fillRect(8, 54, 48, H - 82);

      const activeLine = state.docLines[state.lineIndex];
      const activeChunk = activeLine ? activeLine.chunks[state.chunkIndex] : null;

      for (let i = 0; i < state.docLines.length; i++) {
        const y = baseTopY + i * lineH - scrollPx;
        if (y < 40 || y > H - 14) continue;

        const ln = state.docLines[i];
        const isCur = i === state.lineIndex;

        if (isCur) {
          ctx.fillStyle = 'rgba(59, 130, 246, 0.24)';
          ctx.fillRect(58, y - 24, W - 70, 34);
          if (activeChunk) {
            ctx.fillStyle = 'rgba(147, 197, 253, 0.56)';
            ctx.fillRect(activeChunk.x0 - 5, y - 23, (activeChunk.x1 - activeChunk.x0) + 10, 32);
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(activeChunk.x0 - 3, y + 7, (activeChunk.x1 - activeChunk.x0) + 6, 4);
          }
        }

        ctx.font = '600 15px "JetBrains Mono", ui-monospace, monospace';
        ctx.fillStyle = isCur ? '#ffffff' : '#60a5fa';
        ctx.fillText(String(i + 1).padStart(2, '0'), 18, y - 1);

        ctx.font = isCur
          ? '700 22px "JetBrains Mono", ui-monospace, monospace'
          : '600 22px "JetBrains Mono", ui-monospace, monospace';
        ctx.fillStyle = isCur ? '#ffffff' : (i < state.lineIndex ? '#60a5fa' : '#bfdbfe');
        ctx.fillText(ln.text, 68, y);
      }

      ctx.restore();

      ctx.fillStyle = '#0b1e3d';
      ctx.fillRect(6, H - 28, W - 12, 22);
      const pct = state.docLines.length > 0 ? ((state.lineIndex + 1) / state.docLines.length) : 0;
      ctx.fillStyle = '#3b82f6';
      ctx.fillRect(10, H - 22, (W - 20) * pct, 6);

      if (virtualScreenTexture) virtualScreenTexture.needsUpdate = true;
      state.screenCanvasDirty = false;
    }

    function initVirtualScreenCanvas() {
      virtualScreenCanvas = document.createElement('canvas');
      virtualScreenCanvas.width = 512;
      virtualScreenCanvas.height = 512;
      virtualScreenCtx = virtualScreenCanvas.getContext('2d');

      virtualScreenTexture = new THREE.CanvasTexture(virtualScreenCanvas);
      virtualScreenTexture.colorSpace = THREE.SRGBColorSpace;
      virtualScreenTexture.minFilter = THREE.LinearFilter;
      virtualScreenTexture.magFilter = THREE.LinearFilter;
      virtualScreenTexture.generateMipmaps = false;

      const d0 = SAMPLE_DOCUMENTS[0];
      loadVirtualDocument(d0.title, d0.body);
    }

    /* =========================================================================
6. HÌNH HỌC CHÍNH: ĐẦU ĐIÊU KHẮC MẢNG PHẲNG ASARO CỦA THEON
       ========================================================================= */
    function buildAsaroPlanarHead() {
      const rightVertDefs = {
        // 1. Vòm đỉnh sọ (Crown)
        crown_c:      [0.00,  2.76, -0.18],
        crown_f:      [0.00,  2.58,  0.84],
        crown_s:      [0.84,  2.48,  0.56],
        crown_m:      [1.12,  2.40, -0.34],
        crown_b:      [0.78,  2.36, -1.16],
        crown_o:      [0.00,  2.44, -1.32],

        // 2. Đường chân tóc & Trán trên
        fh_top_c:     [0.00,  2.14,  1.56],
        fh_top_1:     [0.78,  2.08,  1.44],
        fh_top_2:     [1.42,  1.92,  0.76],
        par_top_1:    [1.68,  1.80, -0.26],
        par_top_2:    [1.26,  1.76, -1.32],
        occ_top_c:    [0.00,  1.88, -1.72],

        // 3. Trán giữa & Thái dương
        fh_mid_c:     [0.00,  1.34,  1.86],
        fh_mid_1:     [0.84,  1.32,  1.72],
        fh_mid_2:     [1.52,  1.24,  0.94],
        par_mid_1:    [1.74,  1.06, -0.22],
        par_mid_2:    [1.30,  0.94, -1.42],
        occ_mid_c:    [0.00,  1.02, -1.80],

        // 4. Cung mày nhô & Ấn đường
        glab_top_c:   [0.00,  0.86,  1.96],
        brow_in:      [0.26,  0.84,  1.96],
        brow_peak:    [0.92,  0.86,  1.76],
        brow_out:     [1.48,  0.74,  1.12],
        temp_low:     [1.68,  0.46,  0.04],
        occ_low_s:    [1.24,  0.02, -1.36],
        occ_low_c:    [0.00,  0.02, -1.68],

        // 5. Viền hốc mắt lục giác sâu sắc nét
        orb_in_t:     [0.28,  0.48,  1.70],
        orb_mid_t:    [0.76,  0.53,  1.66],
        orb_out_t:    [1.24,  0.43,  1.38],
        orb_out_b:    [1.26,  0.03,  1.36],
        orb_mid_b:    [0.76, -0.07,  1.62],
        orb_in_b:     [0.32,  0.03,  1.66],

        orb_back_it:  [0.38,  0.40,  1.16],
        orb_back_mt:  [0.76,  0.44,  1.12],
        orb_back_ot:  [1.14,  0.36,  1.02],
        orb_back_ob:  [1.14,  0.08,  1.02],
        orb_back_mb:  [0.76,  0.00,  1.12],
        orb_back_ib:  [0.38,  0.08,  1.16],

        // 6. Mũi phẳng nhô cao chuẩn Asaro
        glab_bot_c:   [0.00,  0.46,  1.80],
        nose_top_r:   [0.13,  0.46,  1.80],
        nose_br_c:    [0.00, -0.04,  2.14],
        nose_mid_r:   [0.16, -0.04,  2.14],
        nose_tip_tc:  [0.00, -0.54,  2.40],
        nose_tip_tr:  [0.20, -0.54,  2.38],
        nose_tip_bc:  [0.00, -0.73,  2.32],
        nose_tip_br:  [0.16, -0.73,  2.30],
        nose_ala_t:   [0.44, -0.46,  1.94],
        nose_ala_b:   [0.46, -0.76,  1.92],
        nose_sub_c:   [0.00, -0.84,  1.94],
        nose_sub_r:   [0.22, -0.82,  1.94],

        // 7. Dải gò má vát ngang Asaro
        cheek_in:     [0.46, -0.14,  1.78],
        cheek_front:  [0.92, -0.34,  1.74],
        cheek_zyg:    [1.56, -0.22,  1.12],
        zyg_back:     [1.68, -0.02,  0.14],

        // 8. Má dưới & rãnh cười
        naso_mid:     [0.82, -0.84,  1.74],
        cheek_low_1:  [1.40, -0.84,  1.06],
        cheek_low_2:  [1.56, -0.78,  0.04],

        // 9. Khối miệng tách mép trên/dưới & cằm hình thang
        phil_c:       [0.00, -1.14,  1.96],
        phil_r:       [0.26, -1.11,  1.92],
        mouth_up_c:   [0.00, -1.31,  1.88],
        mouth_up_m:   [0.30, -1.32,  1.83],
        mouth_lo_c:   [0.00, -1.33,  1.88],
        mouth_lo_m:   [0.30, -1.34,  1.83],
        mouth_corner: [0.64, -1.30,  1.62],
        lip_low_c:    [0.00, -1.52,  1.90],
        lip_low_r:    [0.30, -1.50,  1.83],
        groove_c:     [0.00, -1.78,  1.74],
        groove_r:     [0.42, -1.74,  1.62],
        chin_front_c: [0.00, -2.14,  1.84],
        chin_front_r: [0.44, -2.10,  1.68],
        chin_side:    [0.92, -1.86,  1.18],
        chin_bot_c:   [0.00, -2.42,  1.46],
        chin_bot_r:   [0.46, -2.36,  1.32],

        // 10. Đường xương hàm góc cạnh & Đáy sọ khép kín
        jaw_mid:      [1.24, -1.78,  0.54],
        jaw_angle:    [1.44, -1.46, -0.18],
        mastoid:      [1.24, -1.10, -0.96],
        occ_base_c:   [0.00, -1.16, -1.46],
        base_front_c: [0.00, -2.26,  0.56],
        base_front_r: [0.74, -2.06,  0.48],
        base_back_r:  [0.82, -1.64, -0.58],
        base_back_c:  [0.00, -1.74, -0.82]
      };

      const vertNames = [];
      const baseCoords = [];
      const idxR = {};
      const idxL = {};

      Object.entries(rightVertDefs).forEach(([name, [x, y, z]]) => {
        const idR = vertNames.length;
        vertNames.push(name + '_R');
        baseCoords.push(x, y, z);
        idxR[name] = idR;

        if (Math.abs(x) < 1e-5) {
          idxL[name] = idR;
        } else {
          const idL = vertNames.length;
          vertNames.push(name + '_L');
          baseCoords.push(-x, y, z);
          idxL[name] = idL;
        }
      });

      const hideMidlinePairs = new Set([
        'crown_c|crown_f', 'crown_c|crown_o',
        'crown_f|fh_top_c', 'fh_top_c|fh_mid_c', 'fh_mid_c|glab_top_c',
        'glab_top_c|glab_bot_c', 'glab_bot_c|nose_br_c', 'nose_br_c|nose_tip_tc',
        'nose_tip_tc|nose_tip_bc', 'nose_tip_bc|nose_sub_c',
        'nose_sub_c|phil_c', 'phil_c|mouth_up_c', 'mouth_lo_c|lip_low_c',
        'lip_low_c|groove_c', 'groove_c|chin_front_c', 'chin_front_c|chin_bot_c',
        'chin_bot_c|base_front_c', 'base_front_c|base_back_c', 'base_back_c|occ_base_c',
        'occ_base_c|occ_low_c', 'occ_low_c|occ_mid_c', 'occ_mid_c|occ_top_c', 'occ_top_c|crown_o'
      ]);

      function isHiddenMidlineEdge(nameA, nameB) {
        return hideMidlinePairs.has(`${nameA}|${nameB}`) || hideMidlinePairs.has(`${nameB}|${nameA}`);
      }

      const rightFaces = [
        ['crown_c', 'crown_f', 'crown_s', 'crown_m'],
        ['crown_c', 'crown_m', 'crown_b', 'crown_o'],
        ['crown_f', 'fh_top_c', 'fh_top_1', 'crown_s'],
        ['crown_s', 'fh_top_1', 'fh_top_2', 'crown_m'],
        ['crown_m', 'fh_top_2', 'par_top_1'],
        ['crown_m', 'par_top_1', 'par_top_2', 'crown_b'],
        ['crown_b', 'par_top_2', 'occ_top_c', 'crown_o'],

        ['fh_top_c', 'fh_mid_c', 'fh_mid_1', 'fh_top_1'],
        ['fh_top_1', 'fh_mid_1', 'fh_mid_2', 'fh_top_2'],
        ['fh_top_2', 'fh_mid_2', 'par_mid_1', 'par_top_1'],
        ['par_top_1', 'par_mid_1', 'par_mid_2', 'par_top_2'],
        ['par_top_2', 'par_mid_2', 'occ_mid_c', 'occ_top_c'],

        ['fh_mid_c', 'glab_top_c', 'brow_in'],
        ['fh_mid_c', 'brow_in', 'brow_peak', 'fh_mid_1'],
        ['fh_mid_1', 'brow_peak', 'brow_out', 'fh_mid_2'],
        ['fh_mid_2', 'brow_out', 'temp_low', 'par_mid_1'],
        ['par_mid_1', 'temp_low', 'occ_low_s', 'par_mid_2'],
        ['par_mid_2', 'occ_low_s', 'occ_low_c', 'occ_mid_c'],

        ['glab_top_c', 'glab_bot_c', 'nose_top_r', 'brow_in'],
        ['brow_in', 'nose_top_r', 'orb_in_t'],
        ['brow_in', 'orb_in_t', 'orb_mid_t', 'brow_peak'],
        ['brow_peak', 'orb_mid_t', 'orb_out_t', 'brow_out'],
        ['brow_out', 'orb_out_t', 'orb_out_b', 'cheek_zyg'],
        ['brow_out', 'cheek_zyg', 'zyg_back', 'temp_low'],

        ['orb_in_t',  'orb_back_it', 'orb_back_mt', 'orb_mid_t'],
        ['orb_mid_t', 'orb_back_mt', 'orb_back_ot', 'orb_out_t'],
        ['orb_out_t', 'orb_back_ot', 'orb_back_ob', 'orb_out_b'],
        ['orb_out_b', 'orb_back_ob', 'orb_back_mb', 'orb_mid_b'],
        ['orb_mid_b', 'orb_back_mb', 'orb_back_ib', 'orb_in_b'],
        ['orb_in_b',  'orb_back_ib', 'orb_back_it', 'orb_in_t'],
        ['orb_back_it', 'orb_back_ib', 'orb_back_mb', 'orb_back_mt'],
        ['orb_back_mt', 'orb_back_mb', 'orb_back_ob', 'orb_back_ot'],

        ['glab_bot_c', 'nose_br_c', 'nose_mid_r', 'nose_top_r'],
        ['nose_br_c', 'nose_tip_tc', 'nose_tip_tr', 'nose_mid_r'],
        ['nose_tip_tc', 'nose_tip_bc', 'nose_tip_br', 'nose_tip_tr'],
        ['nose_tip_bc', 'nose_sub_c', 'nose_sub_r', 'nose_tip_br'],
        ['nose_top_r', 'nose_mid_r', 'orb_in_b', 'orb_in_t'],
        ['nose_mid_r', 'cheek_in', 'orb_in_b'],
        ['nose_mid_r', 'nose_tip_tr', 'nose_ala_t', 'cheek_in'],
        ['nose_tip_tr', 'nose_tip_br', 'nose_ala_b', 'nose_ala_t'],
        ['nose_tip_br', 'nose_sub_r', 'nose_ala_b'],

        ['orb_in_b', 'cheek_in', 'cheek_front', 'orb_mid_b'],
        ['orb_mid_b', 'cheek_front', 'cheek_zyg', 'orb_out_b'],
        ['cheek_in', 'nose_ala_t', 'naso_mid', 'cheek_front'],
        ['nose_ala_t', 'nose_ala_b', 'naso_mid'],
        ['cheek_front', 'naso_mid', 'cheek_low_1', 'cheek_zyg'],
        ['cheek_zyg', 'cheek_low_1', 'cheek_low_2', 'zyg_back'],

        ['nose_sub_c', 'phil_c', 'phil_r', 'nose_sub_r'],
        ['nose_sub_r', 'phil_r', 'nose_ala_b'],
        ['nose_ala_b', 'phil_r', 'mouth_corner', 'naso_mid'],
        ['phil_c', 'mouth_up_c', 'mouth_up_m', 'phil_r'],
        ['phil_r', 'mouth_up_m', 'mouth_corner'],
        ['mouth_lo_c', 'lip_low_c', 'lip_low_r', 'mouth_lo_m'],
        ['mouth_lo_m', 'lip_low_r', 'mouth_corner'],
        ['lip_low_c', 'groove_c', 'groove_r', 'lip_low_r'],
        ['lip_low_r', 'groove_r', 'mouth_corner'],
        ['groove_c', 'chin_front_c', 'chin_front_r', 'groove_r'],
        ['chin_front_c', 'chin_bot_c', 'chin_bot_r', 'chin_front_r'],
        ['mouth_corner', 'groove_r', 'chin_front_r', 'chin_side'],
        ['naso_mid', 'mouth_corner', 'chin_side', 'cheek_low_1'],
        ['chin_front_r', 'chin_bot_r', 'chin_side'],

        ['cheek_low_1', 'chin_side', 'jaw_mid', 'cheek_low_2'],
        ['cheek_low_2', 'jaw_mid', 'jaw_angle'],
        ['zyg_back', 'cheek_low_2', 'jaw_angle'],
        ['temp_low', 'zyg_back', 'jaw_angle', 'mastoid'],
        ['temp_low', 'mastoid', 'occ_low_s'],
        ['occ_low_s', 'mastoid', 'occ_base_c', 'occ_low_c'],

        ['chin_bot_c', 'base_front_c', 'base_front_r', 'chin_bot_r'],
        ['chin_bot_r', 'base_front_r', 'chin_side'],
        ['chin_side', 'base_front_r', 'jaw_mid'],
        ['base_front_r', 'base_back_r', 'jaw_angle', 'jaw_mid'],
        ['base_front_c', 'base_back_c', 'base_back_r', 'base_front_r'],
        ['base_back_r', 'mastoid', 'jaw_angle'],
        ['base_back_c', 'occ_base_c', 'mastoid', 'base_back_r']
      ];

      const triIndices = [];
      const planarEdgeSet = new Set();
      const planarEdgePairs = [];
      const triEdgeSet = new Set();
      const triEdgePairs = [];
      const isSocketInteriorVert = (n) => n.startsWith('orb_back_');

      function addEdge(set, arr, i1, i2) {
        const lo = Math.min(i1, i2);
        const hi = Math.max(i1, i2);
        const key = `${lo}_${hi}`;
        if (!set.has(key)) {
          set.add(key);
          arr.push(lo, hi);
        }
      }

      rightFaces.forEach((face) => {
        const isInteriorSocket = face.some(isSocketInteriorVert);

        const rIds = face.map((n) => idxR[n]);
        if (rIds.length === 4) {
          triIndices.push(rIds[0], rIds[1], rIds[2], rIds[0], rIds[2], rIds[3]);
          if (!isInteriorSocket) addEdge(triEdgeSet, triEdgePairs, rIds[0], rIds[2]);
        } else {
          triIndices.push(rIds[0], rIds[1], rIds[2]);
        }

        for (let k = 0; k < face.length; k++) {
          const nA = face[k], nB = face[(k + 1) % face.length];
          const iA = rIds[k], iB = rIds[(k + 1) % face.length];
          if (!isInteriorSocket) {
            addEdge(triEdgeSet, triEdgePairs, iA, iB);
            if (!isHiddenMidlineEdge(nA, nB)) addEdge(planarEdgeSet, planarEdgePairs, iA, iB);
          }
        }

        const lNames = face.length === 4
          ? [face[0], face[3], face[2], face[1]]
          : [face[0], face[2], face[1]];
        const lIds = lNames.map((n) => idxL[n]);

        if (lIds.length === 4) {
          triIndices.push(lIds[0], lIds[1], lIds[2], lIds[0], lIds[2], lIds[3]);
          if (!isInteriorSocket) addEdge(triEdgeSet, triEdgePairs, lIds[0], lIds[2]);
        } else {
          triIndices.push(lIds[0], lIds[1], lIds[2]);
        }

        for (let k = 0; k < lNames.length; k++) {
          const nA = lNames[k], nB = lNames[(k + 1) % lNames.length];
          const iA = lIds[k], iB = lIds[(k + 1) % lNames.length];
          if (!isInteriorSocket) {
            addEdge(triEdgeSet, triEdgePairs, iA, iB);
            if (!isHiddenMidlineEdge(nA, nB)) addEdge(planarEdgeSet, planarEdgePairs, iA, iB);
          }
        }
      });

      const basePositions = new Float32Array(baseCoords);
      const curPositions  = new Float32Array(baseCoords);
      const vertCount = basePositions.length / 3;

      const vertJitter = new Float32Array(vertCount);
      for (let i = 0; i < vertCount; i++) {
        vertJitter[i] = Math.abs(Math.sin(i * 19.31 + 2.71) * 43758.5453) % 1;
      }

      const solidGeo = new THREE.BufferGeometry();
      solidGeo.setAttribute('position', new THREE.BufferAttribute(curPositions, 3));
      solidGeo.setIndex(triIndices);
      solidGeo.computeVertexNormals();

      const solidNormals = solidGeo.attributes.normal.array;

      function buildEdgeGeometry(edgePairs) {
        const posArr = new Float32Array(edgePairs.length * 3);
        const normArr = new Float32Array(edgePairs.length * 3);
        for (let i = 0; i < edgePairs.length; i++) {
          const vi = edgePairs[i];
          posArr[i * 3]     = curPositions[vi * 3]     * 1.003;
          posArr[i * 3 + 1] = curPositions[vi * 3 + 1] * 1.003;
          posArr[i * 3 + 2] = curPositions[vi * 3 + 2] * 1.003;
          normArr[i * 3]     = solidNormals[vi * 3];
          normArr[i * 3 + 1] = solidNormals[vi * 3 + 1];
          normArr[i * 3 + 2] = solidNormals[vi * 3 + 2];
        }
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(posArr, 3));
        geo.setAttribute('normal', new THREE.BufferAttribute(normArr, 3));
        return geo;
      }

      const planarEdgeGeo = buildEdgeGeometry(planarEdgePairs);
      const triWireGeo    = buildEdgeGeometry(triEdgePairs);

      const faceCentroids = [];
      for (let i = 0; i < triIndices.length; i += 3) {
        const a = triIndices[i], b = triIndices[i + 1], c = triIndices[i + 2];
        faceCentroids.push(
          (basePositions[a * 3]     + basePositions[b * 3]     + basePositions[c * 3]) / 3,
          (basePositions[a * 3 + 1] + basePositions[b * 3 + 1] + basePositions[c * 3 + 1]) / 3,
          (basePositions[a * 3 + 2] + basePositions[b * 3 + 2] + basePositions[c * 3 + 2]) / 3
        );
      }

      const mR = (name, dx, dy, dz) => ({ idx: idxR[name], dx, dy, dz });
      const mL = (name, dx, dy, dz) => ({ idx: idxL[name], dx: -dx, dy, dz });
      const mBoth = (name, dx, dy, dz) => (idxR[name] === idxL[name])
        ? [{ idx: idxR[name], dx, dy, dz }]
        : [mR(name, dx, dy, dz), mL(name, dx, dy, dz)];

      const morphTargets = {
        browRaiseL: [
          mL('brow_in',   0.00, 0.14, 0.03),
          mL('brow_peak', 0.00, 0.19, 0.04),
          mL('brow_out',  0.00, 0.10, 0.02),
          mL('orb_mid_t', 0.00, 0.08, 0.02),
          mL('orb_in_t',  0.00, 0.05, 0.01),
          mL('fh_mid_1',  0.00, 0.05, 0.01)
        ],
        browRaiseR: [
          mR('brow_in',   0.00, 0.14, 0.03),
          mR('brow_peak', 0.00, 0.19, 0.04),
          mR('brow_out',  0.00, 0.10, 0.02),
          mR('orb_mid_t', 0.00, 0.08, 0.02),
          mR('orb_in_t',  0.00, 0.05, 0.01),
          mR('fh_mid_1',  0.00, 0.05, 0.01)
        ],
        browFurrow: [
          ...mBoth('glab_top_c',  0.00, -0.07, 0.04),
          ...mBoth('brow_in',    -0.07, -0.09, 0.05),
          ...mBoth('orb_in_t',   -0.04, -0.05, 0.02),
          ...mBoth('orb_mid_t',  -0.02, -0.04, 0.01)
        ],
        cheekLift: [
          ...mBoth('orb_mid_b',   0.00, 0.09, 0.04),
          ...mBoth('cheek_in',    0.02, 0.07, 0.04),
          ...mBoth('cheek_front', 0.05, 0.11, 0.06),
          ...mBoth('naso_mid',    0.04, 0.08, 0.05),
          ...mBoth('cheek_zyg',   0.03, 0.05, 0.03)
        ],
        smile: [
          ...mBoth('mouth_corner', 0.12,  0.15, -0.05),
          ...mBoth('mouth_up_m',   0.04,  0.04, -0.01),
          ...mBoth('mouth_lo_m',   0.04,  0.03, -0.01),
          ...mBoth('phil_r',       0.03,  0.05,  0.01),
          ...mBoth('lip_low_r',    0.04,  0.04, -0.01),
          ...mBoth('naso_mid',     0.05,  0.06,  0.03),
          ...mBoth('groove_r',     0.03,  0.03,  0.00)
        ],
        mouthOpen: [
          ...mBoth('phil_c',       0.00,  0.05,  0.03),
          ...mBoth('phil_r',      -0.02,  0.04,  0.02),
          ...mBoth('mouth_up_c',   0.00,  0.05,  0.02),
          ...mBoth('mouth_up_m',  -0.03,  0.03,  0.01),
          ...mBoth('mouth_lo_c',   0.00, -0.19, -0.04),
          ...mBoth('mouth_lo_m',  -0.04, -0.14, -0.03),
          ...mBoth('mouth_corner',-0.09, -0.04,  0.02),
          ...mBoth('lip_low_c',    0.00, -0.22, -0.02),
          ...mBoth('lip_low_r',   -0.03, -0.17, -0.01),
          ...mBoth('groove_c',     0.00, -0.16, -0.01),
          ...mBoth('groove_r',    -0.02, -0.12, -0.01)
        ],
        mouthPress: [
          ...mBoth('phil_c',       0.00, -0.04, -0.04),
          ...mBoth('phil_r',       0.00, -0.03, -0.03),
          ...mBoth('mouth_up_c',   0.00, -0.01, -0.03),
          ...mBoth('mouth_lo_c',   0.00,  0.01, -0.03),
          ...mBoth('lip_low_c',    0.00,  0.05, -0.04),
          ...mBoth('lip_low_r',    0.00,  0.04, -0.03),
          ...mBoth('mouth_corner', 0.02, -0.02, -0.02)
        ],
        mouthAsym: [
          mL('mouth_corner', -0.05,  0.09, -0.02),
          mL('phil_r',       -0.03,  0.04,  0.00),
          mR('mouth_corner', -0.04, -0.04,  0.01),
          mR('mouth_up_c',   -0.03,  0.01,  0.00),
          mR('mouth_lo_c',   -0.03,  0.01,  0.00),
          mR('lip_low_c',    -0.03,  0.02,  0.01)
        ],
        jawDrop: [
          ...mBoth('chin_front_c', 0.00, -0.16, -0.04),
          ...mBoth('chin_front_r', 0.00, -0.14, -0.03),
          ...mBoth('chin_bot_c',   0.00, -0.16, -0.04),
          ...mBoth('chin_bot_r',   0.00, -0.14, -0.03),
          ...mBoth('chin_side',    0.00, -0.09, -0.02),
          ...mBoth('base_front_c', 0.00, -0.12, -0.03)
        ]
      };

      return {
        solidGeo,
        planarEdgeGeo,
        triWireGeo,
        basePositions,
        vertJitter,
        planarEdgePairs,
        triEdgePairs,
        faceCentroids,
        morphTargets,
        planeCount: rightFaces.length * 2
      };
    }

    function buildAsaroEar(side, solidMat, edgeMat, triWireMat) {
      const group = new THREE.Group();
      const rawVerts = [
        [1.62,  0.44, -0.06],
        [1.56,  0.34, -0.34],
        [1.50, -0.60, -0.32],
        [1.56, -0.68, -0.04],
        [1.92,  0.54, -0.22],
        [2.00,  0.14, -0.52],
        [1.92, -0.38, -0.50],
        [1.76, -0.78, -0.22],
        [1.72, -0.06, -0.22]
      ];

      const posArr = new Float32Array(rawVerts.length * 3);
      for (let i = 0; i < rawVerts.length; i++) {
        posArr[i * 3]     = rawVerts[i][0] * side;
        posArr[i * 3 + 1] = rawVerts[i][1];
        posArr[i * 3 + 2] = rawVerts[i][2];
      }

      const facesR = [
        [0, 3, 8, 4], [4, 8, 5], [8, 6, 5], [8, 7, 6], [3, 7, 8],
        [0, 4, 5, 1], [1, 5, 6, 2], [2, 6, 7, 3]
      ];

      const triIdx = [];
      const planarSet = new Set();
      const planarPairs = [];
      const triSet = new Set();
      const triPairs = [];

      function addEarEdge(set, pairs, a, b) {
        const key = `${Math.min(a, b)}_${Math.max(a, b)}`;
        if (!set.has(key)) {
          set.add(key);
          pairs.push(a, b);
        }
      }

      facesR.forEach((f) => {
        const ord = side > 0
          ? f
          : (f.length === 4 ? [f[0], f[3], f[2], f[1]] : [f[0], f[2], f[1]]);
        if (ord.length === 4) {
          triIdx.push(ord[0], ord[1], ord[2], ord[0], ord[2], ord[3]);
          addEarEdge(triSet, triPairs, ord[0], ord[2]);
        } else {
          triIdx.push(ord[0], ord[1], ord[2]);
        }
        for (let k = 0; k < ord.length; k++) {
          const a = ord[k], b = ord[(k + 1) % ord.length];
          addEarEdge(planarSet, planarPairs, a, b);
          addEarEdge(triSet, triPairs, a, b);
        }
      });

      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(posArr, 3));
      geo.setIndex(triIdx);
      geo.computeVertexNormals();
      const earNormals = geo.attributes.normal.array;

      function makeEarLineGeo(pairs) {
        const ep = new Float32Array(pairs.length * 3);
        const en = new Float32Array(pairs.length * 3);
        for (let i = 0; i < pairs.length; i++) {
          const vi = pairs[i];
          ep[i * 3]     = posArr[vi * 3]     * 1.003;
          ep[i * 3 + 1] = posArr[vi * 3 + 1] * 1.003;
          ep[i * 3 + 2] = posArr[vi * 3 + 2] * 1.003;
          en[i * 3]     = earNormals[vi * 3];
          en[i * 3 + 1] = earNormals[vi * 3 + 1];
          en[i * 3 + 2] = earNormals[vi * 3 + 2];
        }
        const lg = new THREE.BufferGeometry();
        lg.setAttribute('position', new THREE.BufferAttribute(ep, 3));
        lg.setAttribute('normal', new THREE.BufferAttribute(en, 3));
        return lg;
      }

      const solidMesh = new THREE.Mesh(geo, solidMat);
      const planarLines = new THREE.LineSegments(makeEarLineGeo(planarPairs), edgeMat);
      const triLines = new THREE.LineSegments(makeEarLineGeo(triPairs), triWireMat);
      triLines.visible = false;

      group.add(solidMesh, planarLines, triLines);
      return { group, solidMesh, planarLines, triLines };
    }

    function updateAsaroDeformation() {
      if (!asaroData || !headSolidMesh) return;

      const { basePositions, vertJitter, planarEdgePairs, triEdgePairs, morphTargets } = asaroData;
      const solidPos = headSolidMesh.geometry.attributes.position.array;
      solidPos.set(basePositions);

      const e = state.exprCur;
      const applyMorph = (list, weight) => {
        if (Math.abs(weight) < 0.0005) return;
        for (let i = 0; i < list.length; i++) {
          const item = list[i];
          const k = item.idx * 3;
          solidPos[k]     += item.dx * weight;
          solidPos[k + 1] += item.dy * weight;
          solidPos[k + 2] += item.dz * weight;
        }
      };

      applyMorph(morphTargets.browRaiseL, e.browRaiseL);
      applyMorph(morphTargets.browRaiseR, e.browRaiseR);
      applyMorph(morphTargets.browFurrow, e.browFurrow);
      applyMorph(morphTargets.cheekLift,  e.cheekLift);
      applyMorph(morphTargets.smile,      e.smile);
      applyMorph(morphTargets.mouthOpen,  e.mouthOpen);
      applyMorph(morphTargets.mouthPress, e.mouthPress);
      applyMorph(morphTargets.mouthAsym,  e.mouthAsym);
      applyMorph(morphTargets.jawDrop,    e.jawDrop);

      if (state.matrixActive) {
        const revY = state.revealY;
        const vertCount = solidPos.length / 3;
        for (let i = 0; i < vertCount; i++) {
          const k = i * 3;
          const vy = solidPos[k + 1];
          const band = clamp((vy - revY) / 0.95, 0.0, 1.0);
          const settle = 1.0 - smoothstep(0.0, 1.0, band);
          if (settle > 0.001) {
            solidPos[k + 1] += settle * settle * (0.42 + vertJitter[i] * 0.34);
          }
        }
      }

      headSolidMesh.geometry.attributes.position.needsUpdate = true;
      headSolidMesh.geometry.computeVertexNormals();
      const norms = headSolidMesh.geometry.attributes.normal.array;

      const syncEdgeMesh = (mesh, pairs) => {
        if (!mesh || !mesh.visible) return;
        const ePos = mesh.geometry.attributes.position.array;
        const eNorm = mesh.geometry.attributes.normal.array;
        for (let i = 0; i < pairs.length; i++) {
          const vi = pairs[i];
          const k = vi * 3;
          const w = i * 3;
          ePos[w]     = solidPos[k]     * 1.003;
          ePos[w + 1] = solidPos[k + 1] * 1.003;
          ePos[w + 2] = solidPos[k + 2] * 1.003;
          eNorm[w]     = norms[k];
          eNorm[w + 1] = norms[k + 1];
          eNorm[w + 2] = norms[k + 2];
        }
        mesh.geometry.attributes.position.needsUpdate = true;
        mesh.geometry.attributes.normal.needsUpdate = true;
      };

      syncEdgeMesh(headPlanarEdgeMesh, planarEdgePairs);
      syncEdgeMesh(headTriWireMesh, triEdgePairs);
    }

    /**
- Vật liệu tượng sứ trắng ánh lam mờ + shader quét kết tinh Ma trận
     */
    function applyVerticalMatrixReveal(mat, revealUniforms, cacheKey) {
      mat.onBeforeCompile = (shader) => {
        shader.uniforms.uRevealY = revealUniforms.uRevealY;
        shader.uniforms.uMatrixActive = revealUniforms.uMatrixActive;
        shader.uniforms.uScanColor = revealUniforms.uScanColor;

        shader.vertexShader = shader.vertexShader
          .replace('#include <common>', '#include <common>\nvarying float vLocalPosY;')
          .replace('#include <begin_vertex>', '#include <begin_vertex>\nvLocalPosY = position.y;');

        shader.fragmentShader = shader.fragmentShader
          .replace(
            '#include <common>',
            `#include <common>
             uniform float uRevealY;
             uniform float uMatrixActive;
             uniform vec3 uScanColor;
             varying float vLocalPosY;`
          )
          .replace(
            '#include <dithering_fragment>',
            `if (uMatrixActive > 0.5) {
               if (vLocalPosY < uRevealY) discard;
               float scanBand = 1.0 - smoothstep(0.0, 0.30, vLocalPosY - uRevealY);
               gl_FragColor.rgb = mix(gl_FragColor.rgb, uScanColor, scanBand * 0.88);
             }
             #include <dithering_fragment>`
          );
      };
      mat.customProgramCacheKey = () => cacheKey;
      return mat;
    }

    function createAsaroSolidMaterial() {
      const mat = new THREE.MeshStandardMaterial({
        color: '#e5edf7',
        emissive: '#142642',
        emissiveIntensity: 0.34,
        roughness: 0.55,
        metalness: 0.14,
        flatShading: true,
        side: THREE.FrontSide,
        polygonOffset: true,
        polygonOffsetFactor: 1.2,
        polygonOffsetUnits: 1.2
      });
      return applyVerticalMatrixReveal(mat, headMatrixUniforms, 'theon-asaro-solid-v5');
    }

    function createPlanarEdgeMaterial(uniformsObj = planarEdgeUniforms) {
      return new THREE.ShaderMaterial({
        uniforms: uniformsObj,
        transparent: true,
        depthWrite: false,
        vertexShader: `
          varying vec3 vNormalView;
          varying vec3 vViewPos;
          varying float vLocalPosY;
          void main() {
            vLocalPosY = position.y;
            vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
            vNormalView = normalize(normalMatrix * normal);
            vViewPos = -mvPos.xyz;
            gl_Position = projectionMatrix * mvPos;
          }
        `,
        fragmentShader: `
          uniform vec3 uColor;
          uniform vec3 uEdgeMint;
          uniform float uOpacity;
          uniform float uBackFade;
          uniform float uWireOnly;
          uniform float uRevealY;
          uniform float uMatrixActive;

          varying vec3 vNormalView;
          varying vec3 vViewPos;
          varying float vLocalPosY;

          void main() {
            if (uMatrixActive > 0.5 && vLocalPosY < uRevealY) discard;

            vec3 N = normalize(vNormalView);
            vec3 V = normalize(vViewPos);
            float frontMask = smoothstep(-0.22, 0.30, dot(N, V));
            float vis = mix(uBackFade, 1.0, frontMask);

            vec3 col = uColor;
            float alpha = uOpacity * mix(1.0, vis, uWireOnly);

            if (uMatrixActive > 0.5) {
              float edgeBand = 1.0 - smoothstep(0.0, 0.42, vLocalPosY - uRevealY);
              col = mix(col, uEdgeMint, edgeBand * 0.92);
              alpha = max(alpha, edgeBand * 0.96);
            }

            gl_FragColor = vec4(col, clamp(alpha, 0.0, 1.0));
          }
        `
      });
    }

    /* =========================================================================
7. ĐÔI MẮT TRÒNG TRẮNG + MỐNG MẮT XANH LAM + MÍ MẮT MẢNG PHẲNG ASARO
       ========================================================================= */
    function buildAsaroReflectiveEye(isLeft) {
      const container = new THREE.Group();
      const xSign = isLeft ? -1 : 1;
      container.position.set(0.76 * xSign, 0.22, 1.31);

      const gazePivot = new THREE.Group();
      container.add(gazePivot);

      const eyeUniforms = {
        uScreenTex: { value: virtualScreenTexture },
        uAwake: { value: 0.0 },
        uGazeShift: { value: new THREE.Vector2(0, 0) },
        uSclera: { value: new THREE.Color('#eef3fa') },
        uIrisInner: { value: new THREE.Color('#0c2752') },
        uIrisOuter: { value: new THREE.Color('#2563eb') },
        uIrisGlow: { value: new THREE.Color('#60a5fa') }
      };

      const eyeMat = new THREE.ShaderMaterial({
        uniforms: eyeUniforms,
        vertexShader: `
          varying vec3 vLocalNormal;
          varying vec3 vViewNormal;
          varying vec3 vViewPos;

          void main() {
            vLocalNormal = normalize(normal);
            vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
            vViewNormal = normalize(normalMatrix * normal);
            vViewPos = -mvPos.xyz;
            gl_Position = projectionMatrix * mvPos;
          }
        `,
        fragmentShader: `
          uniform sampler2D uScreenTex;
          uniform float uAwake;
          uniform vec2 uGazeShift;
          uniform vec3 uSclera;
          uniform vec3 uIrisInner;
          uniform vec3 uIrisOuter;
          uniform vec3 uIrisGlow;

          varying vec3 vLocalNormal;
          varying vec3 vViewNormal;
          varying vec3 vViewPos;

          void main() {
            vec3 nLoc = normalize(vLocalNormal);
            vec3 N = normalize(vViewNormal);
            vec3 V = normalize(vViewPos);

            float frontMask = smoothstep(-0.04, 0.18, nLoc.z);
            vec2 p = nLoc.xy;
            float r = length(p);
            float ang = atan(p.y, p.x);

            // Tròng trắng (Sclera) có đổ bóng khối cầu 3D và bóng râm nhẹ từ mí trên
            vec3 lightDir = normalize(vec3(-0.35, 0.45, 0.82));
            float sphereShade = mix(0.76, 1.04, clamp(dot(N, lightDir) * 0.5 + 0.5, 0.0, 1.0));
            float socketAO = mix(0.66, 1.0, smoothstep(-0.18, 0.55, nLoc.z));
            float upperLidShadow = mix(0.74, 1.0, smoothstep(0.56, 0.06, nLoc.y));
            vec3 scleraCol = uSclera * sphereShade * socketAO * upperLidShadow;

            // Mống mắt xanh lam sâu + viền limbal mảnh + tròng đen sắc nét
            float irisOuter = 0.56;
            float pupilRad = 0.26;
            float inIris = (1.0 - smoothstep(irisOuter - 0.03, irisOuter + 0.015, r)) * frontMask;
            float inPupil = (1.0 - smoothstep(pupilRad - 0.022, pupilRad + 0.018, r)) * frontMask;

            float fineRays = 0.5 + 0.5 * cos(ang * 16.0);
            float irisRing = smoothstep(0.022, 0.0, abs(r - 0.50)) * 0.62
                           + smoothstep(0.018, 0.0, abs(r - 0.39)) * 0.36;

            vec3 irisBase = mix(uIrisInner, uIrisOuter, smoothstep(pupilRad, irisOuter, r));
            irisBase += uIrisGlow * (fineRays * 0.16 + irisRing * 0.46);
            irisBase *= mix(0.32, 1.0, uAwake);

            float limbalRing = smoothstep(0.052, 0.0, abs(r - (irisOuter - 0.018))) * inIris;
            irisBase = mix(irisBase, uIrisInner * 0.42, limbalRing * 0.72);
            irisBase *= mix(0.84, 1.0, upperLidShadow);

            vec3 pupilCol = vec3(0.008, 0.014, 0.018);

            vec3 eyeCol = mix(scleraCol, irisBase, inIris);
            eyeCol = mix(eyeCol, pupilCol, inPupil);

            // Phản chiếu màn hình chữ sắc nét trên giác mạc kính
            float domeWarp = 1.0 + 0.44 * (r * r);
            vec2 reflCoord = (p * domeWarp) / 0.50 + uGazeShift * 0.17;
            vec2 screenUV = vec2(0.5 - reflCoord.x * 0.5, 0.5 + reflCoord.y * 0.5);

            vec2 boxEdge = smoothstep(0.0, 0.06, screenUV) * smoothstep(1.0, 0.94, screenUV);
            float inScreenRect = boxEdge.x * boxEdge.y * frontMask;
            float corneaMask = 1.0 - smoothstep(0.48, 0.68, r);

            vec3 screenSample = texture2D(uScreenTex, clamp(screenUV, 0.0, 1.0)).rgb;
            float luma = dot(screenSample, vec3(0.299, 0.587, 0.114));
            vec3 crispRefl = screenSample * (0.95 + smoothstep(0.18, 0.75, luma) * 0.78);

            float ndotv = clamp(dot(N, V), 0.0, 1.0);
            float fresnel = pow(1.0 - ndotv, 2.6);

            float reflSurface = mix(0.14, 1.15, inIris);
            float reflWeight = inScreenRect * corneaMask * reflSurface * uAwake * (0.76 + 0.40 * fresnel);
            eyeCol += crispRefl * reflWeight;

            // 2 điểm bắt sáng ấm áp sắc nét (catchlights)
            float catch1 = 1.0 - smoothstep(0.026, 0.058, length(p - vec2(0.18, 0.20)));
            float catch2 = 1.0 - smoothstep(0.014, 0.034, length(p - vec2(-0.14, -0.16)));
            eyeCol += vec3(0.98, 0.99, 1.0) * (catch1 * 0.72 + catch2 * 0.30) * frontMask * uAwake;

            eyeCol += uIrisGlow * fresnel * 0.22 * inIris * uAwake;
            gl_FragColor = vec4(eyeCol, 1.0);
          }
        `
      });

      const eyeRadius = 0.345;
      const eyeballMesh = new THREE.Mesh(new THREE.SphereGeometry(eyeRadius, 34, 24), eyeMat);
      gazePivot.add(eyeballMesh);

      const lidMat = new THREE.MeshStandardMaterial({
        color: '#dce6f3',
        emissive: '#142642',
        emissiveIntensity: 0.16,
        roughness: 0.52,
        metalness: 0.10,
        flatShading: true,
        side: THREE.DoubleSide
      });

      const lidEdgeMat = new THREE.LineBasicMaterial({
        color: '#2563eb',
        transparent: true,
        opacity: 0.65
      });

      // Mí mắt mảng phẳng Asaro dày dặn 4 tầng ôm sát nhãn cầu
      function createPlanarEyelidHood(isUpper) {
        const pivot = new THREE.Group();
        const rInner = eyeRadius + 0.006;
        const rOuter = eyeRadius + 0.030;
        const phiCols = [-1.08, -0.58, 0.0, 0.58, 1.08];
        const archShape = [0.02, 0.065, 0.085, 0.065, 0.02];

        const cols = phiCols.length;
        const rows = 4;
        const pts = [];
        const rimPts = [];

        for (let row = 0; row < rows; row++) {
          for (let col = 0; col < cols; col++) {
            const ph = phiCols[col];
            const arch = archShape[col];
            let r, th;

            if (isUpper) {
              if (row === 0)      { r = rInner;        th = arch; }
              else if (row === 1) { r = rOuter;        th = arch + 0.018; }
              else if (row === 2) { r = rOuter + 0.008; th = 0.46 + arch * 0.45; }
              else                { r = rOuter - 0.004; th = 0.98; }
            } else {
              if (row === 0)      { r = rOuter - 0.004; th = -0.88; }
              else if (row === 1) { r = rOuter + 0.004; th = -0.40 - arch * 0.35; }
              else if (row === 2) { r = rOuter - 0.003; th = -arch - 0.014; }
              else                { r = rInner;         th = -arch; }
            }

            const x = r * Math.cos(th) * Math.sin(ph);
            const y = r * Math.sin(th);
            const z = r * Math.cos(th) * Math.cos(ph);
            pts.push(x, y, z);

            if ((isUpper && row === 1) || (!isUpper && row === 2)) {
              rimPts.push(new THREE.Vector3(x, y, z + 0.004));
            }
          }
        }

        const idx = [];
        for (let row = 0; row < rows - 1; row++) {
          for (let c = 0; c < cols - 1; c++) {
            const a = row * cols + c;
            const b = row * cols + c + 1;
            const d = (row + 1) * cols + c;
            const e = (row + 1) * cols + c + 1;
            idx.push(a, b, e, a, e, d);
          }
        }

        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
        geo.setIndex(idx);
        geo.computeVertexNormals();

        const mesh = new THREE.Mesh(geo, lidMat);
        const rimLine = new THREE.Line(new THREE.BufferGeometry().setFromPoints(rimPts), lidEdgeMat);
        pivot.add(mesh, rimLine);
        return { pivot, rimLine };
      }

      const upperLid = createPlanarEyelidHood(true);
      const lowerLid = createPlanarEyelidHood(false);
      container.add(upperLid.pivot, lowerLid.pivot);

      return {
        container,
        gazePivot,
        uniforms: eyeUniforms,
        upperLidPivot: upperLid.pivot,
        lowerLidPivot: lowerLid.pivot,
        lidMat,
        lidEdgeMat,
        lidRimLines: [upperLid.rimLine, lowerLid.rimLine]
      };
    }

    /* =========================================================================
8. HỆ THỐNG MA TRẬN CHỮ ĐỔ DỌC (THEON + CỤM SINH VẬT THỂ + MƯA NỀN)
       ========================================================================= */
    function createMatrixGlyphAtlas() {
      const canvas = document.createElement('canvas');
      canvas.width = 512;
      canvas.height = 512;
      const ctx = canvas.getContext('2d');

      const glyphs = [
        'T', 'H', 'E', 'O', 'N', '0', '1', '∑',
        '∆', 'λ', '≠', 'ｱ', 'ｲ', 'ｳ', 'ｴ', 'ｵ',
        'ｶ', 'ｷ', 'ｸ', 'ｹ', 'ｺ', 'ｻ', 'ｼ', 'ｽ',
        'ｾ', 'ｿ', 'ﾀ', 'ﾁ', 'ﾂ', 'ﾃ', 'ﾄ', 'ﾅ',
        'ﾆ', 'ﾇ', 'ﾈ', 'ﾉ', '0', '1', 'T', 'H',
        'E', 'O', 'N', '∂', '∞', '√', '≡', '⊕',
        '⊗', '0', '1', 'ﾑ', 'ﾒ', 'ﾓ', 'ﾔ', 'ﾕ',
        'ﾖ', 'ﾗ', 'ﾘ', 'ﾙ', 'ﾚ', 'ﾛ', 'ﾜ', 'ﾝ'
      ];

      ctx.clearRect(0, 0, 512, 512);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = '700 44px "JetBrains Mono", ui-monospace, monospace';

      for (let i = 0; i < 64; i++) {
        const col = i % 8;
        const row = Math.floor(i / 8);
        ctx.fillStyle = '#ffffff';
        ctx.fillText(glyphs[i], col * 64 + 32, row * 64 + 34);
      }

      const tex = new THREE.CanvasTexture(canvas);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.minFilter = THREE.LinearFilter;
      tex.magFilter = THREE.LinearFilter;
      tex.generateMipmaps = false;
      return tex;
    }

    function createInstancedGlyphMesh(count) {
      const baseQuad = new THREE.PlaneGeometry(1, 1);
      const geo = new THREE.InstancedBufferGeometry();
      geo.index = baseQuad.index;
      geo.attributes.position = baseQuad.attributes.position;
      geo.attributes.uv = baseQuad.attributes.uv;
      geo.instanceCount = count;

      const aPos   = new Float32Array(count * 3);
      const aScale = new Float32Array(count);
      const aGlyph = new Float32Array(count);
      const aAlpha = new Float32Array(count);
      const aTint  = new Float32Array(count);

      geo.setAttribute('aPos',   new THREE.InstancedBufferAttribute(aPos, 3));
      geo.setAttribute('aScale', new THREE.InstancedBufferAttribute(aScale, 1));
      geo.setAttribute('aGlyph', new THREE.InstancedBufferAttribute(aGlyph, 1));
      geo.setAttribute('aAlpha', new THREE.InstancedBufferAttribute(aAlpha, 1));
      geo.setAttribute('aTint',  new THREE.InstancedBufferAttribute(aTint, 1));

      const mat = new THREE.ShaderMaterial({
        uniforms: {
          uAtlas: { value: glyphAtlasTexture },
          uColorBase: { value: new THREE.Color('#2563eb') },
          uColorBright: { value: new THREE.Color('#93c5fd') }
        },
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        vertexShader: `
          attribute vec3 aPos;
          attribute float aScale;
          attribute float aGlyph;
          attribute float aAlpha;
          attribute float aTint;

          varying vec2 vUv;
          varying float vAlpha;
          varying float vTint;

          void main() {
            float idx = floor(mod(aGlyph, 64.0));
            float col = mod(idx, 8.0);
            float row = floor(idx / 8.0);
            vUv = vec2((col + uv.x) / 8.0, 1.0 - (row + 1.0 - uv.y) / 8.0);
            vAlpha = aAlpha;
            vTint = aTint;

            vec3 worldPos = aPos + vec3(position.xy * aScale, 0.0);
            gl_Position = projectionMatrix * viewMatrix * vec4(worldPos, 1.0);
          }
        `,
        fragmentShader: `
          uniform sampler2D uAtlas;
          uniform vec3 uColorBase;
          uniform vec3 uColorBright;

          varying vec2 vUv;
          varying float vAlpha;
          varying float vTint;

          void main() {
            if (vAlpha < 0.01) discard;
            float mask = texture2D(uAtlas, vUv).a;
            if (mask < 0.08) discard;
            vec3 col = mix(uColorBase, uColorBright, clamp(vTint, 0.0, 1.0));
            gl_FragColor = vec4(col, mask * vAlpha);
          }
        `
      });

      const mesh = new THREE.Mesh(geo, mat);
      mesh.frustumCulled = false;
      return { mesh, geo, aPos, aScale, aGlyph, aAlpha, aTint };
    }

    function buildMatrixEmergenceSystem(basePositions, faceCentroids) {
      const sculptCount = 840;
      const streamCount = 360;
      const total = sculptCount + streamCount;
      const inst = createInstancedGlyphMesh(total);
      scene.add(inst.mesh);

      const vertCount = basePositions.length / 3;
      const centroidCount = faceCentroids.length / 3;
      const particles = [];

      for (let i = 0; i < sculptCount; i++) {
        let lx, ly, lz;
        if (i % 2 === 0) {
          const vi = (i * 5 + Math.floor(Math.random() * 7)) % vertCount;
          lx = basePositions[vi * 3]     + (Math.random() - 0.5) * 0.18;
          ly = basePositions[vi * 3 + 1] + (Math.random() - 0.5) * 0.14;
          lz = basePositions[vi * 3 + 2] + (Math.random() - 0.5) * 0.18;
        } else {
          const ci = (i * 3 + Math.floor(Math.random() * 5)) % centroidCount;
          lx = faceCentroids[ci * 3]     + (Math.random() - 0.5) * 0.22;
          ly = faceCentroids[ci * 3 + 1] + (Math.random() - 0.5) * 0.18;
          lz = faceCentroids[ci * 3 + 2] + (Math.random() - 0.5) * 0.18;
        }

        const normY = clamp((2.82 - ly) / 5.30, 0.0, 1.0);
        const arriveT = 0.78 + normY * 2.10 + (Math.random() - 0.5) * 0.14;

        particles.push({
          kind: 'sculpt',
          lx, ly, lz,
          startX: lx + (Math.random() - 0.5) * 1.1,
          startY: 5.4 + Math.random() * 2.6,
          arriveT,
          fallDur: 0.68 + Math.random() * 0.42,
          scale: 0.16 + Math.random() * 0.08,
          glyphBase: Math.floor(Math.random() * 64),
          glyphSpeed: 9 + Math.random() * 14
        });
      }

      const numCols = 30;
      for (let i = 0; i < streamCount; i++) {
        const colIdx = i % numCols;
        const rowInCol = Math.floor(i / numCols);
        const colX = ((colIdx / (numCols - 1)) - 0.5) * 8.2 + (Math.random() - 0.5) * 0.20;
        const colZ = HEAD_BASE_POS.z + (Math.random() - 0.5) * 3.0;
        const speed = 3.9 + (colIdx % 5) * 0.75;
        const yOffset = (rowInCol / 12) * 10.5;

        particles.push({
          kind: 'stream',
          x: colX,
          z: colZ,
          yOffset,
          speed,
          isLead: rowInCol === 0,
          scale: 0.20 + Math.random() * 0.07,
          glyphBase: Math.floor(Math.random() * 64),
          glyphSpeed: 8 + Math.random() * 12
        });
      }

      return {
        inst,
        particles,
        update(mt) {
          if (!state.matrixActive) {
            inst.mesh.visible = false;
            return;
          }
          inst.mesh.visible = true;

          const headScale = headFloatGroup ? headFloatGroup.scale.x : 1.0;
          const hx = HEAD_BASE_POS.x;
          const hy = headFloatGroup ? headFloatGroup.position.y : HEAD_BASE_POS.y;
          const hz = HEAD_BASE_POS.z;

          const { aPos, aScale, aGlyph, aAlpha, aTint, geo } = inst;

          for (let i = 0; i < particles.length; i++) {
            const p = particles[i];
            const k = i * 3;

            if (p.kind === 'sculpt') {
              const startT = p.arriveT - p.fallDur;
              if (mt < startT) {
                aAlpha[i] = 0.0;
                continue;
              }
              const fallProg = clamp((mt - startT) / p.fallDur, 0.0, 1.0);
              const eased = 1.0 - Math.pow(1.0 - fallProg, 2.35);

              aPos[k]     = hx + lerp(p.startX, p.lx, eased) * headScale;
              aPos[k + 1] = hy + lerp(p.startY, p.ly, eased) * headScale;
              aPos[k + 2] = hz + p.lz * headScale + 0.08;

              const postHold = mt - p.arriveT;
              let alpha = smoothstep(0.0, 0.16, fallProg);
              let tint = 0.25 + smoothstep(0.76, 1.0, fallProg) * 0.75;

              if (postHold > 0) {
                alpha *= (1.0 - smoothstep(0.0, 0.34, postHold));
                tint = 1.0;
              }

              aScale[i] = p.scale * headScale * (1.0 + (postHold > 0 ? 0.15 : 0.0));
              aGlyph[i] = p.glyphBase + Math.floor(mt * p.glyphSpeed);
              aAlpha[i] = alpha * 0.94;
              aTint[i]  = tint;
            } else {
              const phaseEnv = smoothstep(0.0, 0.24, mt) * (1.0 - smoothstep(2.05, 3.15, mt));
              if (phaseEnv <= 0.005) {
                aAlpha[i] = 0.0;
                continue;
              }
              const rawY = 5.3 - ((mt * p.speed + p.yOffset) % 10.6);
              const pull = smoothstep(0.45, 1.95, mt) * 0.28;
              aPos[k]     = p.x * (1.0 - pull);
              aPos[k + 1] = rawY;
              aPos[k + 2] = p.z;
              aScale[i]   = p.scale;
              aGlyph[i]   = p.glyphBase + Math.floor(mt * p.glyphSpeed);

              const edgeFade = smoothstep(-5.1, -3.9, rawY) * smoothstep(5.1, 4.0, rawY);
              aAlpha[i]   = phaseEnv * edgeFade * (p.isLead ? 0.88 : 0.42);
              aTint[i]    = p.isLead ? 0.92 : 0.18;
            }
          }

          geo.attributes.aPos.needsUpdate = true;
          geo.attributes.aScale.needsUpdate = true;
          geo.attributes.aGlyph.needsUpdate = true;
          geo.attributes.aAlpha.needsUpdate = true;
          geo.attributes.aTint.needsUpdate = true;
        }
      };
    }

    function buildBackgroundMatrixRain() {
      const cols = 16;
      const perCol = 10;
      const total = cols * perCol;
      const inst = createInstancedGlyphMesh(total);
      scene.add(inst.mesh);

      const colConfigs = [];
      for (let c = 0; c < cols; c++) {
        const side = c % 2 === 0 ? -1 : 1;
        colConfigs.push({
          side,
          normOffset: 0.60 + ((c % 8) / 8) * 0.36,
          z: -4.95 - (c % 4) * 0.28,
          speed: 0.68 + (c % 5) * 0.20,
          phase: (c * 1.73) % 10.0,
          xWorld: side * 4.8
        });
      }

      const items = [];
      for (let c = 0; c < cols; c++) {
        for (let r = 0; r < perCol; r++) {
          items.push({
            col: c,
            row: r,
            glyphBase: Math.floor(Math.random() * 64),
            glyphSpeed: 2.2 + Math.random() * 2.4
          });
        }
      }

      function relayout(screenW) {
        const hw = screenW * 0.5;
        for (let c = 0; c < cols; c++) {
          const cfg = colConfigs[c];
          cfg.xWorld = cfg.side * Math.max(3.2, hw * cfg.normOffset);
        }
      }

      relayout(state.screenW);

      return {
        inst,
        relayout,
        update(t) {
          const visible = state.bgMatrixRain && !state.matrixActive;
          inst.mesh.visible = visible;
          if (!visible) return;

          const { aPos, aScale, aGlyph, aAlpha, aTint, geo } = inst;
          for (let i = 0; i < items.length; i++) {
            const it = items[i];
            const cfg = colConfigs[it.col];
            const k = i * 3;

            const y = 5.2 - ((t * cfg.speed + cfg.phase + it.row * 0.44) % 10.4);
            aPos[k]     = cfg.xWorld;
            aPos[k + 1] = y;
            aPos[k + 2] = cfg.z;
            aScale[i]   = 0.22;
            aGlyph[i]   = it.glyphBase + Math.floor(t * it.glyphSpeed);

            const tailFade = 1.0 - it.row / perCol;
            const yFade = smoothstep(-5.0, -3.8, y) * smoothstep(5.0, 3.8, y);
            aAlpha[i] = tailFade * yFade * (it.row === 0 ? 0.30 : 0.14);
            aTint[i]  = it.row === 0 ? 0.78 : 0.14;
          }

          geo.attributes.aPos.needsUpdate = true;
          geo.attributes.aScale.needsUpdate = true;
          geo.attributes.aGlyph.needsUpdate = true;
          geo.attributes.aAlpha.needsUpdate = true;
          geo.attributes.aTint.needsUpdate = true;
        }
      };
    }

    /**
- Cụm hạt ký tự Ma trận cục bộ rơi dọc hội tụ đúng vào vị trí vật thể mới sinh
     */
    function spawnLocalMatrixBurst(centerVec, halfW, halfH, halfD, duration = 1.35) {
      const count = 96;
      const inst = createInstancedGlyphMesh(count);
      scene.add(inst.mesh);

      const particles = [];
      for (let i = 0; i < count; i++) {
        const tx = (Math.random() * 2 - 1) * halfW;
        const ty = (Math.random() * 2 - 1) * halfH;
        const tz = (Math.random() * 2 - 1) * halfD;
        const normY = clamp((halfH - ty) / Math.max(0.01, halfH * 2), 0, 1);
        const arriveT = 0.16 + normY * (duration * 0.68) + (Math.random() - 0.5) * 0.08;
        particles.push({
          tx, ty, tz,
          startX: tx + (Math.random() - 0.5) * 0.45,
          startY: ty + 1.5 + Math.random() * 1.4,
          arriveT,
          fallDur: 0.36 + Math.random() * 0.22,
          scale: 0.12 + Math.random() * 0.06,
          glyphBase: Math.floor(Math.random() * 64),
          glyphSpeed: 11 + Math.random() * 12
        });
      }

      matrixBursts.push({
        inst,
        particles,
        center: centerVec.clone(),
        elapsed: 0,
        duration
      });
    }

    function updateMatrixBursts(dt) {
      for (let b = matrixBursts.length - 1; b >= 0; b--) {
        const burst = matrixBursts[b];
        burst.elapsed += dt;
        const mt = burst.elapsed;

        if (mt >= burst.duration + 0.35) {
          scene.remove(burst.inst.mesh);
          burst.inst.geo.dispose();
          burst.inst.mesh.material.dispose();
          matrixBursts.splice(b, 1);
          continue;
        }

        const { aPos, aScale, aGlyph, aAlpha, aTint, geo } = burst.inst;
        const cx = burst.center.x, cy = burst.center.y, cz = burst.center.z;

        for (let i = 0; i < burst.particles.length; i++) {
          const p = burst.particles[i];
          const k = i * 3;
          const startT = p.arriveT - p.fallDur;

          if (mt < startT) {
            aAlpha[i] = 0.0;
            continue;
          }

          const prog = clamp((mt - startT) / p.fallDur, 0, 1);
          const eased = 1.0 - Math.pow(1.0 - prog, 2.2);

          aPos[k]     = cx + lerp(p.startX, p.tx, eased);
          aPos[k + 1] = cy + lerp(p.startY, p.ty, eased);
          aPos[k + 2] = cz + p.tz + 0.05;

          const post = mt - p.arriveT;
          let alpha = smoothstep(0.0, 0.18, prog);
          let tint = 0.3 + smoothstep(0.7, 1.0, prog) * 0.7;
          if (post > 0) {
            alpha *= (1.0 - smoothstep(0.0, 0.28, post));
            tint = 1.0;
          }

          aScale[i] = p.scale;
          aGlyph[i] = p.glyphBase + Math.floor(mt * p.glyphSpeed);
          aAlpha[i] = alpha * 0.95;
          aTint[i]  = tint;
        }

        geo.attributes.aPos.needsUpdate = true;
        geo.attributes.aScale.needsUpdate = true;
        geo.attributes.aGlyph.needsUpdate = true;
        geo.attributes.aAlpha.needsUpdate = true;
        geo.attributes.aTint.needsUpdate = true;
      }
    }

    function triggerMatrixEmergence() {
      state.matrixActive = true;
      state.matrixTime = 0.0;
      state.revealY = 3.1;
      state.awakeningEyes = 0.0;
      headMatrixUniforms.uMatrixActive.value = 1.0;
      headMatrixUniforms.uRevealY.value = 3.1;

      if (leftEyeObj) leftEyeObj.container.visible = false;
      if (rightEyeObj) rightEyeObj.container.visible = false;
      if (mouthInnerMesh) mouthInnerMesh.visible = false;

      const capText = document.getElementById('caption-text');
      if (capText) {
        capText.textContent = 'Khởi tạo ma trận chữ đổ dọc — đang kết tinh khối điêu khắc mảng phẳng Theon...';
      }
    }

    /* =========================================================================
9. HỆ THỐNG SINH VẬT THỂ 3D PLANAR (KHỐI SÁCH, THẺ GHI CHÚ, ĐỒ THỊ GHIM)
       ========================================================================= */
    function createObjectEdgeMaterial(revealUniforms, baseOpacity = 0.85) {
      return new THREE.ShaderMaterial({
        uniforms: {
          uColor: { value: new THREE.Color('#3b82f6') },
          uHighlight: { value: new THREE.Color('#93c5fd') },
          uOpacity: { value: baseOpacity },
          uHover: { value: 0.0 },
          uRevealY: revealUniforms.uRevealY,
          uMatrixActive: revealUniforms.uMatrixActive
        },
        transparent: true,
        depthWrite: false,
        vertexShader: `
          varying float vLocalPosY;
          void main() {
            vLocalPosY = position.y;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `,
        fragmentShader: `
          uniform vec3 uColor;
          uniform vec3 uHighlight;
          uniform float uOpacity;
          uniform float uHover;
          uniform float uRevealY;
          uniform float uMatrixActive;
          varying float vLocalPosY;

          void main() {
            if (uMatrixActive > 0.5 && vLocalPosY < uRevealY) discard;
            vec3 col = mix(uColor, uHighlight, clamp(uHover, 0.0, 1.0));
            float alpha = clamp(uOpacity + uHover * 0.25, 0.0, 1.0);
            if (uMatrixActive > 0.5) {
              float band = 1.0 - smoothstep(0.0, 0.30, vLocalPosY - uRevealY);
              col = mix(col, vec3(0.75, 0.88, 1.0), band * 0.9);
              alpha = max(alpha, band);
            }
            gl_FragColor = vec4(col, alpha);
          }
        `
      });
    }

    function createFloorShadowDisc() {
      const canvas = document.createElement('canvas');
      canvas.width = 128;
      canvas.height = 128;
      const ctx = canvas.getContext('2d');
      const g = ctx.createRadialGradient(64, 64, 4, 64, 64, 60);
      g.addColorStop(0.0, 'rgba(37, 99, 235, 0.42)');
      g.addColorStop(0.45, 'rgba(37, 99, 235, 0.16)');
      g.addColorStop(1.0, 'rgba(37, 99, 235, 0.0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, 128, 128);

      const tex = new THREE.CanvasTexture(canvas);
      const mesh = new THREE.Mesh(
        new THREE.PlaneGeometry(1.75, 1.75),
        new THREE.MeshBasicMaterial({
          map: tex,
          transparent: true,
          opacity: 0.0,
          depthWrite: false
        })
      );
      mesh.rotation.x = -Math.PI / 2;
      mesh.position.y = -SCREEN_H * 0.5 + 0.02;
      return mesh;
    }

    function makeBookCoverTexture(meta) {
      const c = document.createElement('canvas');
      c.width = 320;
      c.height = 440;
      const ctx = c.getContext('2d');

      // Bìa sứ trắng ánh lam sạch sẽ
      ctx.fillStyle = '#e8f0fa';
      ctx.fillRect(0, 0, 320, 440);

      // Dải gáy xanh lam đậm bên trái
      ctx.fillStyle = '#1d4ed8';
      ctx.fillRect(0, 0, 34, 440);
      ctx.fillStyle = '#60a5fa';
      ctx.fillRect(34, 0, 4, 440);

      // Khung viền hình học Planar
      ctx.strokeStyle = '#2563eb';
      ctx.lineWidth = 4;
      ctx.strokeRect(50, 22, 250, 396);

      // Biểu tượng khối đa giác Asaro đơn giản ở giữa
      ctx.strokeStyle = 'rgba(37, 99, 235, 0.35)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(175, 170);
      ctx.lineTo(245, 225);
      ctx.lineTo(220, 305);
      ctx.lineTo(130, 305);
      ctx.lineTo(105, 225);
      ctx.closePath();
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(175, 170);
      ctx.lineTo(175, 305);
      ctx.moveTo(105, 225);
      ctx.lineTo(245, 225);
      ctx.stroke();

      // Tiêu đề sách
      ctx.fillStyle = '#0f2952';
      ctx.font = '700 24px "JetBrains Mono", ui-monospace, monospace';
      ctx.fillText(meta.title, 64, 78);

      ctx.fillStyle = '#2563eb';
      ctx.font = '600 13px "JetBrains Mono", ui-monospace, monospace';
      ctx.fillText(meta.sub, 64, 108);

      ctx.fillStyle = '#3b82f6';
      ctx.fillRect(64, 124, 120, 3);

      // Mã đáy bìa
      ctx.fillStyle = '#476a99';
      ctx.font = '600 12px "JetBrains Mono", ui-monospace, monospace';
      ctx.fillText(meta.code, 64, 384);
      ctx.fillText('THEON ARCHIVE', 64, 402);

      const tex = new THREE.CanvasTexture(c);
      tex.colorSpace = THREE.SRGBColorSpace;
      return tex;
    }

    function makeNoteCardTexture(tag, text) {
      const c = document.createElement('canvas');
      c.width = 440;
      c.height = 280;
      const ctx = c.getContext('2d');

      // Nền thẻ kính tối xanh lam đậm sắc nét
      ctx.fillStyle = '#061126';
      ctx.fillRect(0, 0, 440, 280);

      // Thanh tiêu đề trên
      ctx.fillStyle = '#102854';
      ctx.fillRect(0, 0, 440, 44);
      ctx.fillStyle = '#3b82f6';
      ctx.fillRect(0, 44, 440, 3);

      // Chấm xanh góc phải
      ctx.fillStyle = '#60a5fa';
      ctx.beginPath();
      ctx.arc(412, 22, 6, 0, Math.PI * 2);
      ctx.fill();

      ctx.strokeStyle = '#3b82f6';
      ctx.lineWidth = 6;
      ctx.strokeRect(3, 3, 434, 274);

      ctx.fillStyle = '#93c5fd';
      ctx.font = '700 16px "JetBrains Mono", ui-monospace, monospace';
      ctx.fillText(tag, 20, 28);

      // Tự động xuống dòng nội dung thẻ
      ctx.fillStyle = '#eef5ff';
      ctx.font = '500 20px "Inter", sans-serif';
      const words = text.split(/\s+/);
      let line = '';
      let y = 88;
      const maxW = 396;
      for (let i = 0; i < words.length; i++) {
        const test = line ? `${line} ${words[i]}` : words[i];
        if (ctx.measureText(test).width > maxW && line) {
          ctx.fillText(line, 22, y);
          line = words[i];
          y += 30;
          if (y > 235) break;
        } else {
          line = test;
        }
      }
      if (line && y <= 240) ctx.fillText(line, 22, y);

      ctx.fillStyle = '#60a5fa';
      ctx.font = '600 12px "JetBrains Mono", ui-monospace, monospace';
      ctx.fillText('THEON // PLANAR NOTE', 22, 258);

      const tex = new THREE.CanvasTexture(c);
      tex.colorSpace = THREE.SRGBColorSpace;
      return tex;
    }

    function pickSafeSpawnPosition(kind) {
      const side = (dynamicObjects.length % 2 === 0) ? -1 : 1;
      const hw = Math.max(3.6, state.screenW * 0.42);
      const minX = Math.min(2.55, hw * 0.52);
      const maxX = Math.min(hw - 0.85, 5.4);
      const x = side * lerp(minX, Math.max(minX + 0.3, maxX), Math.random());
      const y = lerp(-1.2, 2.3, Math.random());
      const z = kind === 'book' ? lerp(-2.9, -1.7, Math.random()) : lerp(-2.6, -1.5, Math.random());
      return new THREE.Vector3(x, y, z);
    }

    function updateObjectCountUI() {
      const el = document.getElementById('obj-count-tag');
      if (el) el.textContent = `${dynamicObjects.length} / ${MAX_DYNAMIC_OBJECTS} VẬT`;
    }

    function disposeDynamicObject(obj) {
      if (hoveredObj === obj) hoveredObj = null;
      if (draggedObj === obj) draggedObj = null;
      dynamicObjectsGroup.remove(obj.group);
      scene.remove(obj.shadowMesh);
      obj.shadowMesh.geometry.dispose();
      if (obj.shadowMesh.material.map) obj.shadowMesh.material.map.dispose();
      obj.shadowMesh.material.dispose();

      obj.group.traverse((child) => {
        if (child.geometry) child.geometry.dispose();
        if (child.material) {
          const mats = Array.isArray(child.material) ? child.material : [child.material];
          mats.forEach((m) => {
            if (m.map) m.map.dispose();
            m.dispose();
          });
        }
      });
    }

    function enforceObjectLimit() {
      while (dynamicObjects.length >= MAX_DYNAMIC_OBJECTS) {
        const oldestIdx = dynamicObjects.findIndex((o) => o !== draggedObj);
        if (oldestIdx < 0) break;
        const [removed] = dynamicObjects.splice(oldestIdx, 1);
        disposeDynamicObject(removed);
      }
    }

    function spawnPlanarBook(customPos = null) {
      enforceObjectLimit();

      const meta = BOOK_CATALOG[bookCycleIdx % BOOK_CATALOG.length];
      bookCycleIdx++;

      const W = 0.92, H = 1.26, D = 0.20;
      const revealUniforms = {
        uRevealY: { value: H * 0.72 },
        uMatrixActive: { value: 1.0 },
        uScanColor: { value: new THREE.Color('#60a5fa') }
      };

      const group = new THREE.Group();
      const coverTex = makeBookCoverTexture(meta);

      const coverMat = applyVerticalMatrixReveal(new THREE.MeshStandardMaterial({
        map: coverTex,
        roughness: 0.45,
        metalness: 0.12
      }), revealUniforms, 'theon-obj-reveal-v1');

      const backCoverMat = applyVerticalMatrixReveal(new THREE.MeshStandardMaterial({
        color: '#dce6f3',
        emissive: '#102340',
        emissiveIntensity: 0.25,
        roughness: 0.55,
        metalness: 0.14,
        flatShading: true
      }), revealUniforms, 'theon-obj-reveal-v1');

      const spineMat = applyVerticalMatrixReveal(new THREE.MeshStandardMaterial({
        color: '#1d4ed8',
        emissive: '#0c2454',
        emissiveIntensity: 0.35,
        roughness: 0.48,
        metalness: 0.18,
        flatShading: true
      }), revealUniforms, 'theon-obj-reveal-v1');

      const pagesMat = applyVerticalMatrixReveal(new THREE.MeshStandardMaterial({
        color: '#f1f5f9',
        emissive: '#1e293b',
        emissiveIntensity: 0.12,
        roughness: 0.75,
        metalness: 0.04
      }), revealUniforms, 'theon-obj-reveal-v1');

      // Thân bìa sách
      const bookGeo = new THREE.BoxGeometry(W, H, D);
      // Thứ tự mặt BoxGeometry: +X (mép trang), -X (gáy), +Y (đầu trang), -Y (đáy trang), +Z (bìa trước), -Z (bìa sau)
      const bookMesh = new THREE.Mesh(bookGeo, [
        pagesMat, spineMat, pagesMat, pagesMat, coverMat, backCoverMat
      ]);
      group.add(bookMesh);

      // Viền cạnh xanh lam sắc nét
      const edgeMat = createObjectEdgeMaterial(revealUniforms, 0.88);
      const edges = new THREE.LineSegments(new THREE.EdgesGeometry(bookGeo), edgeMat);
      edges.scale.setScalar(1.006);
      group.add(edges);

      const spawnPos = customPos ? customPos.clone() : pickSafeSpawnPosition('book');
      group.position.copy(spawnPos);
      group.rotation.set(
        (Math.random() - 0.5) * 0.24,
        spawnPos.x > 0 ? -0.32 : 0.32,
        (Math.random() - 0.5) * 0.18
      );
      dynamicObjectsGroup.add(group);

      const shadowMesh = createFloorShadowDisc();
      shadowMesh.position.x = spawnPos.x;
      shadowMesh.position.z = spawnPos.z;
      scene.add(shadowMesh);

      const obj = {
        kind: 'book',
        label: `Sách "${meta.title}"`,
        group,
        hitMesh: bookMesh,
        edgeMat,
        revealUniforms,
        shadowMesh,
        halfH: H * 0.5,
        restHeight: D * 0.5 + 0.03,
        phase: 'materializing',
        matTime: 0,
        matDuration: 1.3,
        floatLife: 22 + Math.random() * 6, // 22-28 giây lơ lửng
        baseY: spawnPos.y,
        bobPhase: Math.random() * Math.PI * 2,
        vel: new THREE.Vector3(),
        angVel: new THREE.Vector3(
          (Math.random() - 0.5) * 0.35,
          (Math.random() - 0.5) * 0.45,
          (Math.random() - 0.5) * 0.30
        )
      };
      bookMesh.userData.dynamicObj = obj;

      dynamicObjects.push(obj);
      spawnLocalMatrixBurst(spawnPos, W * 0.55, H * 0.55, D * 0.8, 1.3);
      updateObjectCountUI();
      return obj;
    }

    function spawnPlanarNoteCard(customPos = null) {
      enforceObjectLimit();

      let tag, text;
      if (state.docLines.length > 0 && Math.random() < 0.65) {
        const idx = (state.lineIndex + noteCycleIdx) % state.docLines.length;
        tag = `DOC // LINE ${String(idx + 1).padStart(2, '0')}`;
        text = state.docLines[idx].text;
      } else {
        const fb = FALLBACK_NOTES[noteCycleIdx % FALLBACK_NOTES.length];
        tag = fb.tag;
        text = fb.body;
      }
      noteCycleIdx++;

      const W = 1.48, H = 0.94, D = 0.045;
      const revealUniforms = {
        uRevealY: { value: H * 0.72 },
        uMatrixActive: { value: 1.0 },
        uScanColor: { value: new THREE.Color('#60a5fa') }
      };

      const group = new THREE.Group();
      const cardTex = makeNoteCardTexture(tag, text);

      const frontMat = applyVerticalMatrixReveal(new THREE.MeshStandardMaterial({
        map: cardTex,
        emissive: '#0c234a',
        emissiveIntensity: 0.38,
        roughness: 0.36,
        metalness: 0.14
      }), revealUniforms, 'theon-obj-reveal-v1');

      const sideMat = applyVerticalMatrixReveal(new THREE.MeshStandardMaterial({
        color: '#1e3a8a',
        emissive: '#172554',
        emissiveIntensity: 0.35,
        roughness: 0.45,
        metalness: 0.20
      }), revealUniforms, 'theon-obj-reveal-v1');

      const cardGeo = new THREE.BoxGeometry(W, H, D);
      const cardMesh = new THREE.Mesh(cardGeo, [
        sideMat, sideMat, sideMat, sideMat, frontMat, frontMat
      ]);
      group.add(cardMesh);

      const edgeMat = createObjectEdgeMaterial(revealUniforms, 0.92);
      const edges = new THREE.LineSegments(new THREE.EdgesGeometry(cardGeo), edgeMat);
      edges.scale.setScalar(1.008);
      group.add(edges);

      const spawnPos = customPos ? customPos.clone() : pickSafeSpawnPosition('card');
      group.position.copy(spawnPos);
      group.rotation.set(
        (Math.random() - 0.5) * 0.14,
        spawnPos.x > 0 ? -0.24 : 0.24,
        (Math.random() - 0.5) * 0.12
      );
      dynamicObjectsGroup.add(group);

      const shadowMesh = createFloorShadowDisc();
      shadowMesh.position.x = spawnPos.x;
      shadowMesh.position.z = spawnPos.z;
      scene.add(shadowMesh);

      const obj = {
        kind: 'card',
        label: `Thẻ ghi chú (${tag})`,
        group,
        hitMesh: cardMesh,
        edgeMat,
        revealUniforms,
        shadowMesh,
        halfH: H * 0.5,
        restHeight: D * 0.5 + 0.03,
        phase: 'materializing',
        matTime: 0,
        matDuration: 1.25,
        floatLife: 22 + Math.random() * 6, // 22-28 giây lơ lửng
        baseY: spawnPos.y,
        bobPhase: Math.random() * Math.PI * 2,
        vel: new THREE.Vector3(),
        angVel: new THREE.Vector3(
          (Math.random() - 0.5) * 0.28,
          (Math.random() - 0.5) * 0.36,
          (Math.random() - 0.5) * 0.22
        )
      };
      cardMesh.userData.dynamicObj = obj;

      dynamicObjects.push(obj);
      spawnLocalMatrixBurst(spawnPos, W * 0.52, H * 0.52, 0.25, 1.25);
      updateObjectCountUI();
      return obj;
    }

    function clearDynamicObjects() {
      while (dynamicObjects.length > 0) {
        const obj = dynamicObjects.pop();
        disposeDynamicObject(obj);
      }
      document.getElementById('canvas-container').style.cursor = 'default';
      updateObjectCountUI();
    }

    /**
- Đồ thị 3D ghim cố định ngay màn hình trước mặt Theon (z = -1.25)
- Hỗ trợ 3 kiểu: Sóng hàm (wave), Biểu đồ cột 3D (bars), Quỹ đạo (orbit)
     */
    function buildPinnedGraphObject() {
      const W = 3.55, H = 1.62;
      const revealUniforms = {
        uRevealY: { value: H * 0.7 },
        uMatrixActive: { value: 1.0 },
        uScanColor: { value: new THREE.Color('#60a5fa') }
      };

      const group = new THREE.Group();
      // Ghim cố định ngay trước mặt Theon, hơi ngửa nhẹ cho cả Theon và người xem quan sát rõ
      group.position.set(0.0, -2.55, -1.25);
      group.rotation.x = -0.16;
      group.visible = false;

      // Mặt kính đồ thị bán trong suốt nền đen xanh lam
      const panelGeo = new THREE.PlaneGeometry(W, H);
      const panelMat = applyVerticalMatrixReveal(new THREE.MeshStandardMaterial({
        color: '#041026',
        emissive: '#0a224d',
        emissiveIntensity: 0.45,
        transparent: true,
        opacity: 0.72,
        roughness: 0.25,
        metalness: 0.25,
        side: THREE.DoubleSide
      }), revealUniforms, 'theon-obj-reveal-v1');
      const panelMesh = new THREE.Mesh(panelGeo, panelMat);
      group.add(panelMesh);

      // Khung viền xanh lam + lưới trục tọa độ bên trong bảng
      const edgeMat = createObjectEdgeMaterial(revealUniforms, 0.92);
      const frameLines = new THREE.LineSegments(new THREE.EdgesGeometry(panelGeo), edgeMat);
      frameLines.position.z = 0.01;
      group.add(frameLines);

      const gridPts = [];
      for (let gx = -3; gx <= 3; gx++) {
        const x = (gx / 3.5) * (W * 0.46);
        gridPts.push(x, -H * 0.42, 0.015, x, H * 0.42, 0.015);
      }
      for (let gy = -1; gy <= 1; gy++) {
        const y = gy * (H * 0.28);
        gridPts.push(-W * 0.46, y, 0.015, W * 0.46, y, 0.015);
      }
      const gridGeo = new THREE.BufferGeometry();
      gridGeo.setAttribute('position', new THREE.Float32BufferAttribute(gridPts, 3));
      const gridMat = createObjectEdgeMaterial(revealUniforms, 0.24);
      group.add(new THREE.LineSegments(gridGeo, gridMat));

      // --- Mode 1: Sóng hàm 3D (Wave) ---
      const waveGroup = new THREE.Group();
      const waveCount = 48;
      const wavePos1 = new Float32Array(waveCount * 3);
      const wavePos2 = new Float32Array(waveCount * 3);
      const waveGeo1 = new THREE.BufferGeometry();
      const waveGeo2 = new THREE.BufferGeometry();
      waveGeo1.setAttribute('position', new THREE.BufferAttribute(wavePos1, 3));
      waveGeo2.setAttribute('position', new THREE.BufferAttribute(wavePos2, 3));
      const waveLine1 = new THREE.Line(waveGeo1, new THREE.LineBasicMaterial({ color: '#93c5fd' }));
      const waveLine2 = new THREE.Line(waveGeo2, new THREE.LineBasicMaterial({ color: '#2563eb' }));
      waveGroup.add(waveLine1, waveLine2);
      group.add(waveGroup);

      // --- Mode 2: Biểu đồ cột 3D (Bars) ---
      const barsGroup = new THREE.Group();
      const bars = [];
      const barCount = 12;
      const barMat = applyVerticalMatrixReveal(new THREE.MeshStandardMaterial({
        color: '#3b82f6',
        emissive: '#1d4ed8',
        emissiveIntensity: 0.55,
        roughness: 0.35,
        metalness: 0.2,
        flatShading: true
      }), revealUniforms, 'theon-obj-reveal-v1');
      const barEdgeMat = new THREE.LineBasicMaterial({ color: '#bfdbfe', transparent: true, opacity: 0.75 });
      for (let i = 0; i < barCount; i++) {
        const bx = ((i / (barCount - 1)) - 0.5) * (W * 0.80);
        const bGeo = new THREE.BoxGeometry(0.16, 1.0, 0.14);
        bGeo.translate(0, 0.5, 0);
        const mesh = new THREE.Mesh(bGeo, barMat);
        mesh.add(new THREE.LineSegments(new THREE.EdgesGeometry(bGeo), barEdgeMat));
        mesh.position.set(bx, -H * 0.38, 0.08);
        barsGroup.add(mesh);
        bars.push(mesh);
      }
      barsGroup.visible = false;
      group.add(barsGroup);

      // --- Mode 3: Quỹ đạo pha 3D (Orbit / Lissajous) ---
      const orbitGroup = new THREE.Group();
      const orbitCount = 96;
      const orbitPos = new Float32Array(orbitCount * 3);
      const orbitGeo = new THREE.BufferGeometry();
      orbitGeo.setAttribute('position', new THREE.BufferAttribute(orbitPos, 3));
      const orbitLine = new THREE.Line(orbitGeo, new THREE.LineBasicMaterial({ color: '#60a5fa' }));
      const orbitDot = new THREE.Mesh(
        new THREE.OctahedronGeometry(0.075, 0),
        new THREE.MeshBasicMaterial({ color: '#dbeafe' })
      );
      orbitGroup.add(orbitLine, orbitDot);
      orbitGroup.visible = false;
      group.add(orbitGroup);

      scene.add(group);

      return {
        group,
        W, H,
        revealUniforms,
        matTime: 0,
        matDuration: 1.25,
        materializing: false,
        waveGroup, wavePos1, wavePos2, waveGeo1, waveGeo2, waveCount,
        barsGroup, bars,
        orbitGroup, orbitPos, orbitGeo, orbitCount, orbitDot
      };
    }

    function setPinnedGraphVisible(visible) {
      state.graphVisible = Boolean(visible);
      const qBtn = document.getElementById('btn-quick-graph');
      const hBtn = document.getElementById('btn-hud-graph');
      if (qBtn) qBtn.classList.toggle('active', state.graphVisible);
      if (hBtn) hBtn.classList.toggle('active', state.graphVisible);

      if (!pinnedGraphObj) return;
      if (state.graphVisible) {
        pinnedGraphObj.group.visible = true;
        pinnedGraphObj.materializing = true;
        pinnedGraphObj.matTime = 0;
        pinnedGraphObj.revealUniforms.uMatrixActive.value = 1.0;
        pinnedGraphObj.revealUniforms.uRevealY.value = pinnedGraphObj.H * 0.7;
        spawnLocalMatrixBurst(pinnedGraphObj.group.position, pinnedGraphObj.W * 0.5, pinnedGraphObj.H * 0.5, 0.25, 1.25);
        if (state.autoExpression) setExpression('focused', false);
      } else {
        pinnedGraphObj.group.visible = false;
        pinnedGraphObj.materializing = false;
      }
    }

    function setPinnedGraphMode(mode) {
      state.graphMode = mode;
      if (!pinnedGraphObj) return;
      pinnedGraphObj.waveGroup.visible  = (mode === 'wave');
      pinnedGraphObj.barsGroup.visible  = (mode === 'bars');
      pinnedGraphObj.orbitGroup.visible = (mode === 'orbit');
    }

    function updatePinnedGraph(dt, t) {
      if (!pinnedGraphObj || !state.graphVisible) return;
      const g = pinnedGraphObj;

      if (g.materializing) {
        g.matTime += dt;
        const p = smoothstep(0, g.matDuration, g.matTime);
        g.revealUniforms.uRevealY.value = lerp(g.H * 0.7, -g.H * 0.75, p);
        if (g.matTime >= g.matDuration) {
          g.materializing = false;
          g.revealUniforms.uMatrixActive.value = 0.0;
        }
      }

      if (state.graphMode === 'wave') {
        for (let i = 0; i < g.waveCount; i++) {
          const u = i / (g.waveCount - 1);
          const x = (u - 0.5) * (g.W * 0.86);
          const y1 = Math.sin(u * 10.5 - t * 2.8) * 0.42 * Math.sin(u * Math.PI);
          const z1 = 0.10 + Math.cos(u * 7.0 - t * 2.1) * 0.08;
          const y2 = Math.cos(u * 8.2 + t * 2.1) * 0.30 * Math.sin(u * Math.PI);
          const z2 = 0.05;
          g.wavePos1[i * 3] = x; g.wavePos1[i * 3 + 1] = y1; g.wavePos1[i * 3 + 2] = z1;
          g.wavePos2[i * 3] = x; g.wavePos2[i * 3 + 1] = y2; g.wavePos2[i * 3 + 2] = z2;
        }
        g.waveGeo1.attributes.position.needsUpdate = true;
        g.waveGeo2.attributes.position.needsUpdate = true;
      } else if (state.graphMode === 'bars') {
        for (let i = 0; i < g.bars.length; i++) {
          const h = 0.22 + 0.88 * (0.5 + 0.5 * Math.sin(t * 2.4 + i * 0.65) * Math.cos(t * 1.1 - i * 0.3));
          g.bars[i].scale.y = h;
        }
      } else if (state.graphMode === 'orbit') {
        for (let i = 0; i < g.orbitCount; i++) {
          const a = (i / (g.orbitCount - 1)) * Math.PI * 2;
          const x = Math.sin(a * 2 + t * 0.8) * (g.W * 0.34);
          const y = Math.sin(a * 3 - t * 1.1) * (g.H * 0.34);
          const z = 0.14 + Math.cos(a * 2 + t * 0.8) * 0.12;
          g.orbitPos[i * 3] = x; g.orbitPos[i * 3 + 1] = y; g.orbitPos[i * 3 + 2] = z;
        }
        g.orbitGeo.attributes.position.needsUpdate = true;
        const headA = (t * 1.6) % (Math.PI * 2);
        g.orbitDot.position.set(
          Math.sin(headA * 2 + t * 0.8) * (g.W * 0.34),
          Math.sin(headA * 3 - t * 1.1) * (g.H * 0.34),
          0.14 + Math.cos(headA * 2 + t * 0.8) * 0.12
        );
        g.orbitDot.rotation.y = t * 3.0;
      }
    }

    function updateDynamicObjects(dt, t) {
      const floorY = -SCREEN_H * 0.5;
      const hw = state.screenW * 0.5 - 0.65;

      // Tự động sinh vật thể nếu người dùng bật công tắc
      if (state.autoSpawnEnabled && !state.matrixActive) {
        state.autoSpawnTimer -= dt;
        if (state.autoSpawnTimer <= 0) {
          if (Math.random() < 0.5) spawnPlanarBook();
          else spawnPlanarNoteCard();
          state.autoSpawnTimer = 8.5 + Math.random() * 5.0;
        }
      }

      for (let i = 0; i < dynamicObjects.length; i++) {
        const obj = dynamicObjects[i];
        const isHovered = (hoveredObj === obj);
        const isDragged = (draggedObj === obj);

        // Làm sáng viền xanh lam khi hover hoặc đang cầm kéo
        const targetHover = isDragged ? 1.0 : (isHovered ? 0.85 : 0.0);
        obj.edgeMat.uniforms.uHover.value = lerp(obj.edgeMat.uniforms.uHover.value, targetHover, Math.min(1, dt * 14));

        // 1. Pha kết tinh từ Ma trận chữ
        if (obj.phase === 'materializing') {
          obj.matTime += dt;
          const p = smoothstep(0, obj.matDuration, obj.matTime);
          obj.revealUniforms.uRevealY.value = lerp(obj.halfH * 1.35, -obj.halfH * 1.45, p);
          if (obj.matTime >= obj.matDuration) {
            obj.revealUniforms.uMatrixActive.value = 0.0;
            obj.phase = 'floating';
          }
        }

        // 2. Pha đang được nhặt & kéo bằng chuột/chạm
        if (isDragged) {
          obj.group.rotation.x = lerp(obj.group.rotation.x, 0.04, Math.min(1, dt * 9));
          obj.group.rotation.y = lerp(obj.group.rotation.y, -obj.group.position.x * 0.08, Math.min(1, dt * 9));
          obj.group.rotation.z = lerp(obj.group.rotation.z, 0.0, Math.min(1, dt * 9));
          obj.baseY = obj.group.position.y;
          obj.vel.set(0, 0, 0);
        } else if (obj.phase === 'floating') {
          // 3. Pha lơ lửng bồng bềnh tự nhiên trong ~22-28 giây
          obj.floatLife -= dt;
          obj.group.position.y = obj.baseY + Math.sin(t * 1.35 + obj.bobPhase) * 0.11;
          obj.group.rotation.y += dt * 0.18 * (obj.bobPhase > Math.PI ? 1 : -1);

          if (obj.floatLife <= 0) {
            obj.phase = 'falling';
            obj.vel.set((Math.random() - 0.5) * 0.28, -0.18, (Math.random() - 0.5) * 0.15);
          }
        } else if (obj.phase === 'falling') {
          // 4. Pha mất lực nâng & trôi rớt xuống nền có trọng trường nhẹ
          obj.vel.y -= 2.65 * dt;
          obj.group.position.addScaledVector(obj.vel, dt);
          obj.group.position.x = clamp(obj.group.position.x, -hw, hw);
          obj.group.position.z = clamp(obj.group.position.z, -BOX_DEPTH + 0.65, -0.85);

          obj.group.rotation.x += obj.angVel.x * dt;
          obj.group.rotation.y += obj.angVel.y * dt;
          obj.group.rotation.z += obj.angVel.z * dt;

          const landY = floorY + obj.restHeight;
          if (obj.group.position.y <= landY) {
            obj.group.position.y = landY;
            if (Math.abs(obj.vel.y) > 0.55) {
              // Nảy nhẹ một nhịp khi chạm sàn
              obj.vel.y = -obj.vel.y * 0.28;
              obj.vel.x *= 0.6;
              obj.vel.z *= 0.6;
            } else {
              obj.vel.set(0, 0, 0);
              obj.phase = 'grounded';
            }
          }
        } else if (obj.phase === 'grounded') {
          // 5. Nằm yên phẳng tự nhiên trên sàn đen
          obj.group.position.y = lerp(obj.group.position.y, floorY + obj.restHeight, Math.min(1, dt * 10));
          obj.group.rotation.x = lerp(obj.group.rotation.x, -Math.PI * 0.5, Math.min(1, dt * 8));
          obj.group.rotation.z = lerp(obj.group.rotation.z, 0.0, Math.min(1, dt * 6));
        }

        // Đồng bộ bóng đổ trên mặt sàn đen dưới vật thể
        const heightAboveFloor = Math.max(0, obj.group.position.y - floorY);
        const shadowStrength = clamp(1.0 - heightAboveFloor / 5.5, 0.06, 0.95);
        obj.shadowMesh.position.x = obj.group.position.x;
        obj.shadowMesh.position.z = obj.group.position.z;
        obj.shadowMesh.scale.setScalar(lerp(1.35, 0.85, shadowStrength));
        obj.shadowMesh.material.opacity = shadowStrength * (obj.phase === 'materializing' ? 0.35 : 0.82);
      }
    }

    /* =========================================================================
10. KHỞI TẠO CẢNH 3D, ÁNH SÁNG STUDIO & CỤM ĐẦU ASARO THEON
       ========================================================================= */
    function initScene() {
      const container = document.getElementById('canvas-container');
      const w = window.innerWidth;
      const h = window.innerHeight;

      scene = new THREE.Scene();
      scene.background = new THREE.Color('#02050b');

      camera = new THREE.PerspectiveCamera(45, w / h, CAM_NEAR, CAM_FAR);

      renderer = new THREE.WebGLRenderer({
        antialias: true,
        powerPreference: 'high-performance'
      });
      renderer.setSize(w, h);
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.10;
      container.appendChild(renderer.domElement);

      // HỆ THỐNG ÁNH SÁNG ĐIÊU KHẮC STUDIO (tượng sứ trắng nổi bật trên nền đen)
      hemiLight = new THREE.HemisphereLight('#ffffff', '#3b5b8c', 0.95);
      scene.add(hemiLight);

      keyLight = new THREE.DirectionalLight('#ffffff', 1.72);
      keyLight.position.set(-4.8, 5.4, 4.6);
      scene.add(keyLight);

      rimLight = new THREE.DirectionalLight('#3b82f6', 1.55);
      rimLight.position.set(5.4, 3.8, -5.2);
      scene.add(rimLight);

      screenFaceLight = new THREE.PointLight('#bfdbfe', 1.25, 11.5, 1.45);
      screenFaceLight.position.set(0.0, 0.15, -0.55);
      scene.add(screenFaceLight);

      // 1. Màn hình tài liệu ảo 512×512 phản chiếu trong mắt
      initVirtualScreenCanvas();

      // 2. Atlas ký tự Ma trận
      glyphAtlasTexture = createMatrixGlyphAtlas();

      // 3. Khối đầu điêu khắc phẳng Asaro của Theon
      headFloatGroup = new THREE.Group();
      headFloatGroup.position.copy(HEAD_BASE_POS);
      scene.add(headFloatGroup);

      headRig = new THREE.Group();
      headFloatGroup.add(headRig);

      asaroData = buildAsaroPlanarHead();

      const solidMat = createAsaroSolidMaterial();
      headSolidMesh = new THREE.Mesh(asaroData.solidGeo, solidMat);
      headRig.add(headSolidMesh);

      const planarEdgeMat = createPlanarEdgeMaterial();
      headPlanarEdgeMesh = new THREE.LineSegments(asaroData.planarEdgeGeo, planarEdgeMat);
      headRig.add(headPlanarEdgeMesh);

      headTriWireMesh = new THREE.LineSegments(asaroData.triWireGeo, planarEdgeMat);
      headTriWireMesh.visible = false;
      headRig.add(headTriWireMesh);

      mouthInnerMesh = new THREE.Mesh(
        new THREE.PlaneGeometry(0.96, 0.44),
        new THREE.MeshBasicMaterial({ color: '#01040a', side: THREE.DoubleSide })
      );
      mouthInnerMesh.position.set(0, -1.36, 1.54);
      headRig.add(mouthInnerMesh);

      earGroup = new THREE.Group();
      [-1, 1].forEach((side) => {
        const ear = buildAsaroEar(side, solidMat, planarEdgeMat, planarEdgeMat);
        earObjects.push(ear);
        earGroup.add(ear.group);
      });
      headRig.add(earGroup);

      leftEyeObj  = buildAsaroReflectiveEye(true);
      rightEyeObj = buildAsaroReflectiveEye(false);
      headRig.add(leftEyeObj.container, rightEyeObj.container);

      const planeBadge = document.getElementById('plane-badge');
      if (planeBadge) planeBadge.textContent = `${asaroData.planeCount} MẢNG PHẲNG`;

      // 4. Hộp 3D âm nền đen viền xanh lam đóng khung
      buildRecessedBox();

      // 5. Nhóm vật thể 3D động & Đồ thị ghim cố định trước mặt Theon
      dynamicObjectsGroup = new THREE.Group();
      scene.add(dynamicObjectsGroup);
      pinnedGraphObj = buildPinnedGraphObject();
      rebuildBoxDimensions();

      // 6. Hệ thống ma trận chữ đổ dọc hội tụ & mưa nền nhẹ
      emergenceSystem = buildMatrixEmergenceSystem(asaroData.basePositions, asaroData.faceCentroids);
      bgRainSystem = buildBackgroundMatrixRain();

      applyHeadStyle('planar');
      triggerMatrixEmergence();

      bindEvents();
      bindUI();
    }

    /* =========================================================================
11. CẬP NHẬT TRẠNG THÁI, ĐỌC TÀI LIỆU, 7 BIỂU CẢM & VÒNG LẶP 60FPS
       ========================================================================= */
    function setExpression(exprName, fromUser = false) {
      if (!EXPRESSION_PRESETS[exprName]) return;
      state.currentExpr = exprName;

      if (fromUser && state.autoExpression) {
        state.autoExpression = false;
        const sw = document.getElementById('sw-auto-expr');
        if (sw) {
          sw.classList.remove('on');
          sw.setAttribute('aria-checked', 'false');
        }
      }

      document.querySelectorAll('.expr-btn').forEach((b) => {
        b.classList.toggle('active', b.dataset.expr === exprName);
      });

      const meta = EXPRESSION_META[exprName];
      const ind = document.getElementById('expr-indicator');
      const pill = document.getElementById('caption-expr-pill');
      if (ind) ind.textContent = meta.tag;
      if (pill) pill.textContent = meta.tag;
    }

    function updateCaptionDisplay() {
      const capText = document.getElementById('caption-text');
      const lineTag = document.getElementById('doc-line-tag');
      if (lineTag) lineTag.textContent = `DÒNG ${String(state.lineIndex + 1).padStart(2, '0')}`;

      if (!capText || state.matrixActive) return;

      if (draggedObj) {
        capText.textContent = `Đang cầm ${draggedObj.label} — Theon đang dõi theo vật thể trên tay bạn.`;
      } else if (state.mode === 'reading' && state.docLines.length) {
        const ln = state.docLines[state.lineIndex];
        capText.textContent = `“${ln.text}”`;
      } else {
        capText.textContent = `Đang tương tác chuột — Theon dõi theo ánh nhìn của bạn (${EXPRESSION_META[state.currentExpr].label}).`;
      }
    }

    function triggerBlink() {
      if (state.blinkPhase === 0) {
        state.blinkPhase = 0.001;
        state.blinkDuration = 0.14;
      }
    }

    function triggerNod(strength = 0.65) {
      if (state.nodPhase === 0) {
        state.nodPhase = 0.001;
        state.nodStrength = strength;
      }
    }

    function updateMouthBackingVisibility() {
      if (!mouthInnerMesh) return;
      const opaqueMode = state.headStyle === 'planar' || state.headStyle === 'sculpture';
      const revealed = !state.matrixActive || state.revealY < -1.30;
      mouthInnerMesh.visible = opaqueMode && revealed;
    }

    function updateMatrixSequence(dt) {
      if (!state.matrixActive) return;

      state.matrixTime += dt;
      const mt = state.matrixTime;

      if (mt < 0.72) {
        state.revealY = 3.1;
        state.awakeningEyes = 0.0;
      } else if (mt < 2.95) {
        const p = smoothstep(0.72, 2.95, mt);
        state.revealY = lerp(3.1, -2.7, p);

        const eyePassed = state.revealY < 0.08;
        if (leftEyeObj) leftEyeObj.container.visible = eyePassed;
        if (rightEyeObj) rightEyeObj.container.visible = eyePassed;
        updateMouthBackingVisibility();

        state.awakeningEyes = smoothstep(2.55, 3.25, mt);
      } else {
        state.revealY = -3.2;
        if (leftEyeObj) leftEyeObj.container.visible = true;
        if (rightEyeObj) rightEyeObj.container.visible = true;
        updateMouthBackingVisibility();
        state.awakeningEyes = smoothstep(2.55, 3.25, mt);

        if (mt >= 3.05 && mt - dt < 3.05) {
          triggerBlink();
          triggerNod(0.62);
          if (state.autoExpression) setExpression('friendly', false);
        }
      }

      headMatrixUniforms.uRevealY.value = state.revealY;
      wallBoxUniforms.uRevealGlow.value = Math.sin(clamp(mt / MATRIX_DURATION, 0, 1) * Math.PI);

      if (emergenceSystem) emergenceSystem.update(mt);

      if (mt >= MATRIX_DURATION) {
        state.matrixActive = false;
        state.awakeningEyes = 1.0;
        headMatrixUniforms.uMatrixActive.value = 0.0;
        wallBoxUniforms.uRevealGlow.value = 0.0;
        if (emergenceSystem) emergenceSystem.inst.mesh.visible = false;
        updateMouthBackingVisibility();
        updateCaptionDisplay();

        // Sinh sẵn 1 khối sách & 1 thẻ ghi chú ngay lần đầu đánh thức để trải nghiệm lập tức
        if (!state.initialDemoSpawned) {
          state.initialDemoSpawned = true;
          const hw = Math.min(state.screenW * 0.30, 3.4);
          spawnPlanarBook(new THREE.Vector3(-hw, 0.55, -2.15));
          spawnPlanarNoteCard(new THREE.Vector3(hw, 0.65, -2.05));
        }
      }
    }

    function updateVirtualReading(dt) {
      if (state.matrixActive || state.mode !== 'reading' || !state.docLines.length || draggedObj) return;

      const focusMul = state.currentExpr === 'focused' ? 1.18 : (state.currentExpr === 'relaxed' ? 0.80 : 1.0);
      state.fixationTimer -= dt * state.readSpeed * focusMul;

      if (state.fixationTimer <= 0) {
        const line = state.docLines[state.lineIndex];
        if (state.chunkIndex + 1 < line.chunks.length) {
          state.chunkIndex++;
          const ch = line.chunks[state.chunkIndex];
          state.targetGazeDocU = ch.cx / 512;
          state.fixationTimer = clamp(0.24 + ch.text.length * 0.017, 0.24, 0.56);
          state.screenLightPulse = 0.16;
          state.screenCanvasDirty = true;

          if (state.autoExpression && ch.exprHint && ch.exprHint !== state.currentExpr) {
            setExpression(ch.exprHint, false);
          }
        } else {
          if (line.endOfPara) {
            triggerNod(0.48);
            if (Math.random() < 0.65) triggerBlink();
          } else if (Math.random() < 0.35) {
            triggerBlink();
          }

          state.lineIndex = (state.lineIndex + 1) % state.docLines.length;
          state.chunkIndex = 0;

          const nextLine = state.docLines[state.lineIndex];
          const firstCh = nextLine.chunks[0];
          state.targetGazeDocU = firstCh.cx / 512;

          state.targetScrollOffset = Math.max(0, state.lineIndex - 3.0);
          const visibleRow = state.lineIndex - state.targetScrollOffset;
          state.targetGazeDocV = clamp((92 + visibleRow * 44) / 512, 0.18, 0.78);

          state.fixationTimer = line.endOfPara ? 0.50 : 0.34;
          state.screenLightPulse = 0.32;
          state.screenCanvasDirty = true;

          if (state.autoExpression) setExpression(nextLine.lineExpr, false);
          updateCaptionDisplay();
        }
      }

      const prevScroll = state.scrollOffset;
      state.scrollOffset = lerp(state.scrollOffset, state.targetScrollOffset, Math.min(1, dt * 6.5));
      if (Math.abs(state.scrollOffset - prevScroll) > 0.002) {
        state.screenCanvasDirty = true;
      }

      const saccadeLerp = Math.min(1, dt * 24.0);
      state.gazeDocU = lerp(state.gazeDocU, state.targetGazeDocU, saccadeLerp);
      state.gazeDocV = lerp(state.gazeDocV, state.targetGazeDocV, saccadeLerp);

      if (state.screenCanvasDirty) renderVirtualScreenCanvas();
    }

    function updateBlinkingAndEyelids(dt) {
      if (state.blinkPhase > 0) {
        state.blinkPhase += dt / state.blinkDuration;
        if (state.blinkPhase >= 1.0) {
          state.blinkPhase = 0;
          state.blinkVal = 0;
          if (state.doubleBlinkPending) {
            state.doubleBlinkPending = false;
            state.blinkTimer = 0.14;
          } else {
            state.blinkTimer = 2.6 + Math.random() * 3.4;
          }
        } else {
          state.blinkVal = Math.sin(state.blinkPhase * Math.PI);
        }
      } else if (!state.matrixActive) {
        state.blinkTimer -= dt;
        if (state.blinkTimer <= 0) {
          state.blinkPhase = 0.001;
          state.blinkDuration = 0.135 + Math.random() * 0.045;
          state.doubleBlinkPending = Math.random() < 0.22;
        }
      }

      const b = state.blinkVal;
      const e = state.exprCur;
      const awake = state.awakeningEyes;

      const openUpperRot = clamp(-0.28 - e.lidUpper * 0.20, -0.50, -0.06);
      const closedUpperRot = 0.14;
      const upperRot = lerp(closedUpperRot, lerp(openUpperRot, closedUpperRot, b), awake);

      const openLowerRot = clamp(0.22 - e.lidLower * 0.20, 0.02, 0.34);
      const closedLowerRot = -0.06;
      const lowerRot = lerp(closedLowerRot, lerp(openLowerRot, closedLowerRot, b * 0.90), awake);

      [leftEyeObj, rightEyeObj].forEach((eye) => {
        if (!eye) return;
        eye.upperLidPivot.rotation.x = upperRot;
        eye.lowerLidPivot.rotation.x = lowerRot;
        eye.uniforms.uAwake.value = awake * (1.0 - smoothstep(0.45, 0.92, b) * 0.85);
      });
    }

    function computeBinocularEyeAngles(eyeObj, targetWorld, headYaw, headPitch) {
      eyeObj.container.getWorldPosition(tempEyeWorld);
      const dx = targetWorld.x - tempEyeWorld.x;
      const dy = targetWorld.y - tempEyeWorld.y;
      const dz = Math.max(0.8, targetWorld.z - tempEyeWorld.z);

      const absYaw = Math.atan2(dx, dz);
      const absPitch = -Math.atan2(dy, Math.hypot(dx, dz));

      return {
        yaw: clamp(absYaw - headYaw, -0.34, 0.34),
        pitch: clamp(absPitch - headPitch, -0.25, 0.25)
      };
    }

    const statusSublineEl = document.getElementById('status-subline');
    const fpsEl = document.getElementById('hud-fps');
    let fpsFrames = 0;
    let fpsAccum = 0;

    function animate() {
      if (!running) return;
      rafId = requestAnimationFrame(animate);

      const dt = Math.min(clock.getDelta(), 0.05);
      const t = clock.elapsedTime;

      state.closeUpT = lerp(state.closeUpT, state.closeUpMode ? 1.0 : 0.0, Math.min(1, dt * 4.5));

      const targetCamX = state.parallaxEnabled ? state.pointerX * 1.05 : 0.0;
      const targetCamY = state.parallaxEnabled ? state.pointerY * 0.65 : 0.0;
      state.eyeCamX = lerp(state.eyeCamX, targetCamX, Math.min(1, dt * 5.2));
      state.eyeCamY = lerp(state.eyeCamY, targetCamY, Math.min(1, dt * 5.2));
      updateCameraProjection(state.eyeCamX, state.eyeCamY);

      updateMatrixSequence(dt);
      updateMatrixBursts(dt);
      if (bgRainSystem) bgRainSystem.update(t);

      // Cập nhật vật thể động (sách/thẻ) & đồ thị 3D ghim cố định
      updateDynamicObjects(dt, t);
      updatePinnedGraph(dt, t);

      const targetPreset = EXPRESSION_PRESETS[state.currentExpr] || EXPRESSION_PRESETS.friendly;
      const exprLerp = Math.min(1, dt * 6.5);
      for (let i = 0; i < EXPR_KEYS.length; i++) {
        const k = EXPR_KEYS[i];
        state.exprCur[k] = lerp(state.exprCur[k], targetPreset[k], exprLerp);
      }
      updateAsaroDeformation();

      const breathFreq = state.currentExpr === 'relaxed' ? 0.78 : (state.currentExpr === 'happy' ? 1.50 : 1.08);
      const floatY = Math.sin(t * breathFreq) * 0.062 + Math.sin(t * 0.48) * 0.016;
      const happyBob = state.currentExpr === 'happy' ? Math.sin(t * 3.0) * 0.020 : 0.0;

      headFloatGroup.position.set(
        HEAD_BASE_POS.x,
        HEAD_BASE_POS.y + floatY + happyBob,
        HEAD_BASE_POS.z + state.exprCur.headZAdd
      );
      wallBoxUniforms.uHeadFloat.value = floatY;

      let nodPitch = 0;
      if (state.nodPhase > 0) {
        state.nodPhase += dt * 2.5;
        if (state.nodPhase >= 1.0) state.nodPhase = 0;
        else nodPitch = Math.sin(state.nodPhase * Math.PI) * 0.072 * state.nodStrength;
      }

      updateVirtualReading(dt);
      updateBlinkingAndEyelids(dt);

      state.screenLightPulse = lerp(state.screenLightPulse, 0.0, Math.min(1, dt * 5.0));
      if (screenFaceLight) {
        const flicker = Math.sin(t * 2.3) * 0.08 + state.screenLightPulse;
        screenFaceLight.intensity = (1.25 + flicker * 0.5) * lerp(0.45, 1.0, state.awakeningEyes);
        screenFaceLight.position.x = (state.gazeDocU - 0.5) * 1.8;
        screenFaceLight.position.y = 0.20 + (0.5 - state.gazeDocV) * 0.9;
      }

      const idleRoll = Math.sin(t * 0.60) * 0.016;
      let targetYaw = 0;
      let targetPitch = 0;
      let targetRoll = idleRoll + state.exprCur.headRollAdd;

      if (state.matrixActive) {
        targetYaw = 0;
        targetPitch = lerp(0.08, 0.0, state.awakeningEyes) + nodPitch;
        tempTargetWorld.set(0, 0.25, 0.5);
      } else if (draggedObj) {
        // Khi người dùng cầm/kéo sách hoặc thẻ, đầu và ánh mắt Theon tự động dõi theo vật thể
        draggedObj.group.getWorldPosition(tempObjWorld);
        tempTargetWorld.copy(tempObjWorld);

        const eyeOriginY = headFloatGroup.position.y + 0.22 * headFloatGroup.scale.y;
        const dx = tempTargetWorld.x - headFloatGroup.position.x;
        const dy = tempTargetWorld.y - eyeOriginY;
        const dz = Math.max(0.85, tempTargetWorld.z - headFloatGroup.position.z);

        targetYaw   = clamp(Math.atan2(dx, dz) * 0.56, -0.46, 0.46);
        targetPitch = clamp(-Math.atan2(dy, Math.hypot(dx, dz)) * 0.52 + nodPitch, -0.32, 0.34);
        targetRoll  = idleRoll - targetYaw * 0.14;
      } else if (state.mode === 'reading') {
        const virtualX = (0.5 - state.gazeDocU) * 4.4;
        const virtualY = (0.5 - state.gazeDocV) * 2.8 + (state.graphVisible ? -0.42 : 0.12);
        tempTargetWorld.set(virtualX, virtualY, 0.25);

        const eyeOriginY = headFloatGroup.position.y + 0.22 * headFloatGroup.scale.y;
        const dx = tempTargetWorld.x - headFloatGroup.position.x;
        const dy = tempTargetWorld.y - eyeOriginY;
        const dz = Math.max(1.2, tempTargetWorld.z - headFloatGroup.position.z);

        targetYaw   = clamp(Math.atan2(dx, dz) * 0.34, -0.34, 0.34);
        targetPitch = clamp(-Math.atan2(dy, Math.hypot(dx, dz)) * 0.38 + state.exprCur.headPitchAdd + nodPitch, -0.26, 0.28);
        targetRoll  = idleRoll + state.exprCur.headRollAdd - targetYaw * 0.11;
      } else {
        tempTargetWorld.set(
          state.pointerX * (state.screenW * 0.42),
          state.pointerY * (state.screenH * 0.40),
          0.45
        );
        const eyeOriginY = headFloatGroup.position.y + 0.22 * headFloatGroup.scale.y;
        const dx = tempTargetWorld.x - headFloatGroup.position.x;
        const dy = tempTargetWorld.y - eyeOriginY;
        const dz = Math.max(1.2, tempTargetWorld.z - headFloatGroup.position.z);

        targetYaw   = clamp(Math.atan2(dx, dz) * 0.52, -0.44, 0.44);
        targetPitch = clamp(-Math.atan2(dy, Math.hypot(dx, dz)) * 0.46 + state.exprCur.headPitchAdd + nodPitch, -0.30, 0.30);
        targetRoll  = idleRoll + state.exprCur.headRollAdd - state.pointerX * 0.06;
      }

      const headSmooth = draggedObj ? 6.2 : (state.mode === 'reading' ? 3.8 : 4.8);
      state.headYaw   = lerp(state.headYaw,   targetYaw,   Math.min(1, dt * headSmooth));
      state.headPitch = lerp(state.headPitch, targetPitch, Math.min(1, dt * headSmooth));
      state.headRoll  = lerp(state.headRoll,  targetRoll,  Math.min(1, dt * 4.2));

      headRig.rotation.y = state.headYaw;
      headRig.rotation.x = state.headPitch;
      headRig.rotation.z = state.headRoll;
      headRig.updateWorldMatrix(true, true);

      if (leftEyeObj && rightEyeObj) {
        const lAng = computeBinocularEyeAngles(leftEyeObj,  tempTargetWorld, state.headYaw, state.headPitch);
        const rAng = computeBinocularEyeAngles(rightEyeObj, tempTargetWorld, state.headYaw, state.headPitch);

        const eyeSpeed = draggedObj ? 18.0 : (state.mode === 'reading' ? 22.0 : 14.0);
        state.leftEyeYaw    = lerp(state.leftEyeYaw,    lAng.yaw,    Math.min(1, dt * eyeSpeed));
        state.leftEyePitch  = lerp(state.leftEyePitch,  lAng.pitch,  Math.min(1, dt * eyeSpeed));
        state.rightEyeYaw   = lerp(state.rightEyeYaw,   rAng.yaw,    Math.min(1, dt * eyeSpeed));
        state.rightEyePitch = lerp(state.rightEyePitch, rAng.pitch,  Math.min(1, dt * eyeSpeed));

        leftEyeObj.gazePivot.rotation.y  = state.leftEyeYaw;
        leftEyeObj.gazePivot.rotation.x  = state.leftEyePitch;
        rightEyeObj.gazePivot.rotation.y = state.rightEyeYaw;
        rightEyeObj.gazePivot.rotation.x = state.rightEyePitch;

        leftEyeObj.uniforms.uGazeShift.value.set(state.leftEyeYaw * 1.4, -state.leftEyePitch * 1.4);
        rightEyeObj.uniforms.uGazeShift.value.set(state.rightEyeYaw * 1.4, -state.rightEyePitch * 1.4);
      }

      renderer.render(scene, camera);

      fpsFrames++;
      fpsAccum += dt;
      if (fpsAccum >= 0.22) {
        if (fpsEl) fpsEl.textContent = `${Math.round(fpsFrames / fpsAccum)} FPS`;
        if (statusSublineEl) {
          if (state.matrixActive) {
            const pct = Math.min(100, Math.round((state.matrixTime / MATRIX_DURATION) * 100));
            statusSublineEl.textContent = `Đang kết tinh từ ma trận... ${pct}%`;
          } else if (draggedObj) {
            statusSublineEl.textContent = `Đang cầm: ${draggedObj.label}`;
          } else {
            const exprLabel = EXPRESSION_META[state.currentExpr].label;
            const modeTxt = state.mode === 'reading' ? 'Đọc tài liệu' : 'Tương tác chuột';
            const camTxt = state.closeUpMode ? ' · Cận mắt' : '';
            statusSublineEl.textContent = `Theon · ${modeTxt} · ${exprLabel}${camTxt}`;
          }
        }
        fpsFrames = 0;
        fpsAccum = 0;
      }
    }

    /* =========================================================================
12. CHẾ ĐỘ HIỂN THỊ KHỐI PLANAR, RAYCASTER PICK & DRAG & GIAO DIỆN
       ========================================================================= */
    function applyHeadStyle(style) {
      state.headStyle = style;
      if (!headSolidMesh) return;
      const mat = headSolidMesh.material;

      const setEarDisplay = (showSolid, showPlanar, showTri) => {
        earObjects.forEach((e) => {
          e.solidMesh.visible = showSolid;
          e.planarLines.visible = showPlanar;
          e.triLines.visible = showTri;
        });
      };

      const setLidRimOpacity = (op) => {
        [leftEyeObj, rightEyeObj].forEach((eye) => {
          if (!eye) return;
          eye.lidRimLines.forEach((l) => { l.material.opacity = op; });
        });
      };

      if (style === 'planar') {
        headSolidMesh.visible = true;
        headPlanarEdgeMesh.visible = true;
        headTriWireMesh.visible = false;
        mat.transparent = false;
        mat.opacity = 1.0;
        mat.depthWrite = true;
        mat.needsUpdate = true;
        planarEdgeUniforms.uWireOnly.value = 0.0;
        planarEdgeUniforms.uOpacity.value = state.edgeBrightness;
        setEarDisplay(true, true, false);
        setLidRimOpacity(state.edgeBrightness * 0.85);
      } else if (style === 'sculpture') {
        headSolidMesh.visible = true;
        headPlanarEdgeMesh.visible = false;
        headTriWireMesh.visible = false;
        mat.transparent = false;
        mat.opacity = 1.0;
        mat.depthWrite = true;
        mat.needsUpdate = true;
        setEarDisplay(true, false, false);
        setLidRimOpacity(0.10);
      } else if (style === 'translucent') {
        headSolidMesh.visible = true;
        headPlanarEdgeMesh.visible = true;
        headTriWireMesh.visible = false;
        mat.transparent = true;
        mat.opacity = 0.34;
        mat.depthWrite = false;
        mat.needsUpdate = true;
        planarEdgeUniforms.uWireOnly.value = 1.0;
        planarEdgeUniforms.uBackFade.value = 0.22;
        planarEdgeUniforms.uOpacity.value = Math.max(0.45, state.edgeBrightness);
        setEarDisplay(true, true, false);
        setLidRimOpacity(0.55);
      } else {
        headSolidMesh.visible = false;
        headPlanarEdgeMesh.visible = false;
        headTriWireMesh.visible = true;
        planarEdgeUniforms.uWireOnly.value = 1.0;
        planarEdgeUniforms.uBackFade.value = 0.25;
        planarEdgeUniforms.uOpacity.value = Math.max(0.50, state.edgeBrightness);
        setEarDisplay(false, false, true);
        setLidRimOpacity(0.62);
      }

      updateMouthBackingVisibility();
      updateAsaroDeformation();
    }

    function toggleHud(force) {
      const panel = document.getElementById('hud-panel');
      const btn = document.getElementById('btn-toggle-hud');
      const lbl = document.getElementById('toggle-hud-label');
      state.hudVisible = typeof force === 'boolean' ? force : !state.hudVisible;

      panel.classList.toggle('panel-hidden', !state.hudVisible);
      btn.setAttribute('aria-expanded', String(state.hudVisible));
      lbl.textContent = state.hudVisible ? 'Ẩn HUD [H]' : 'Hiện HUD [H]';
    }

    function toggleCloseUp(force) {
      state.closeUpMode = typeof force === 'boolean' ? force : !state.closeUpMode;
      const btn = document.getElementById('btn-eye-closeup');
      const lbl = document.getElementById('label-closeup');
      if (btn) btn.classList.toggle('active', state.closeUpMode);
      if (lbl) lbl.textContent = state.closeUpMode ? 'Toàn cảnh [Z]' : 'Cận mắt [Z]';
    }

    function updatePointerNDC(e) {
      pointerNDC.x = (e.clientX / window.innerWidth) * 2 - 1;
      pointerNDC.y = -(e.clientY / window.innerHeight) * 2 + 1;
      state.pointerX = clamp(pointerNDC.x, -1, 1);
      state.pointerY = clamp(pointerNDC.y, -1, 1);
    }

    function raycastDynamicObjects() {
      if (dynamicObjects.length === 0) return null;
      raycaster.setFromCamera(pointerNDC, camera);
      const hitMeshes = dynamicObjects.map((o) => o.hitMesh);
      const hits = raycaster.intersectObjects(hitMeshes, false);
      if (hits.length > 0) {
        return {
          obj: hits[0].object.userData.dynamicObj,
          point: hits[0].point
        };
      }
      return null;
    }

    function bindEvents() {
      const canvasEl = document.getElementById('canvas-container');

      canvasEl.addEventListener('pointerdown', (e) => {
        if (e.button !== 0 && e.pointerType === 'mouse') return;
        updatePointerNDC(e);
        const hit = raycastDynamicObjects();
        if (hit && hit.obj) {
          draggedObj = hit.obj;
          hoveredObj = hit.obj;
          // Đưa vật thể đang cầm lên một mặt phẳng kéo thoải mái phía trước
          const dragZ = clamp(draggedObj.group.position.z, -4.4, -1.45);
          dragPlane.set(new THREE.Vector3(0, 0, 1), -dragZ);
          raycaster.setFromCamera(pointerNDC, camera);
          if (raycaster.ray.intersectPlane(dragPlane, dragIntersect)) {
            dragOffset.copy(draggedObj.group.position).sub(dragIntersect);
            dragOffset.z = 0;
          } else {
            dragOffset.set(0, 0, 0);
          }

          if (draggedObj.phase !== 'materializing') {
            draggedObj.phase = 'floating';
          }
          draggedObj.vel.set(0, 0, 0);
          canvasEl.style.cursor = 'grabbing';
          if (canvasEl.setPointerCapture) canvasEl.setPointerCapture(e.pointerId);
          updateCaptionDisplay();
        }
      });

      window.addEventListener('pointermove', (e) => {
        updatePointerNDC(e);

        if (draggedObj) {
          raycaster.setFromCamera(pointerNDC, camera);
          if (raycaster.ray.intersectPlane(dragPlane, dragIntersect)) {
            const hw = state.screenW * 0.5 - 0.65;
            const hh = SCREEN_H * 0.5 - 0.55;
            const nx = clamp(dragIntersect.x + dragOffset.x, -hw, hw);
            const ny = clamp(dragIntersect.y + dragOffset.y, -hh + draggedObj.restHeight, hh);
            draggedObj.group.position.x = nx;
            draggedObj.group.position.y = ny;
            draggedObj.baseY = ny;
          }
          return;
        }

        // Chỉ đổi con trỏ hover khi chuột nằm trên canvas
        if (e.target === renderer.domElement) {
          const hit = raycastDynamicObjects();
          hoveredObj = hit ? hit.obj : null;
          canvasEl.style.cursor = hoveredObj ? 'grab' : 'default';
        } else {
          hoveredObj = null;
        }
      }, { passive: true, signal });

      const finishDrag = (e) => {
        if (!draggedObj) return;
        const floorY = -SCREEN_H * 0.5;
        if (draggedObj.group.position.y <= floorY + 0.55) {
          // Thả rất sát sàn -> đặt nhẹ xuống sàn
          draggedObj.phase = 'grounded';
        } else {
          // Thả trên không -> reset bộ đếm lơ lửng thêm ~24 giây
          draggedObj.phase = 'floating';
          draggedObj.floatLife = 24.0;
          draggedObj.baseY = draggedObj.group.position.y;
        }
        draggedObj = null;
        canvasEl.style.cursor = hoveredObj ? 'grab' : 'default';
        if (e && e.pointerId !== undefined && canvasEl.releasePointerCapture) {
          try { canvasEl.releasePointerCapture(e.pointerId); } catch (_) {}
        }
        updateCaptionDisplay();
      };

      window.addEventListener('pointerup', finishDrag, { signal });
      window.addEventListener('pointercancel', finishDrag, { signal });

      document.addEventListener('mouseleave', () => {
        if (!draggedObj) {
          state.pointerX = 0;
          state.pointerY = 0;
        }
      }, { signal });

      window.addEventListener('resize', () => {
        if (!renderer) return;
        renderer.setSize(window.innerWidth, window.innerHeight);
        rebuildBoxDimensions();
      }, { signal });

      window.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
          const modal = document.getElementById('custom-modal');
          if (modal && modal.classList.contains('open')) {
            modal.classList.remove('open');
          }
          return;
        }
        const tag = document.activeElement && document.activeElement.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA') return;
        const k = e.key.toLowerCase();
        if (k === 'h') toggleHud();
        else if (k === 'm') triggerMatrixEmergence();
        else if (k === 'z') toggleCloseUp();
        else if (k === '1') spawnPlanarBook();
        else if (k === '2') spawnPlanarNoteCard();
        else if (k === '3') setPinnedGraphVisible(!state.graphVisible);
        else if (k === 'x') clearDynamicObjects();
      }, { signal });
    }

    function bindUI() {
      document.getElementById('btn-toggle-hud').addEventListener('click', () => toggleHud());
      if (window.innerWidth < 760) toggleHud(false);

      document.getElementById('btn-matrix-replay').addEventListener('click', () => triggerMatrixEmergence());
      document.getElementById('btn-eye-closeup').addEventListener('click', () => toggleCloseUp());

      // Các nút sinh vật thể Ma trận (Quick bar + HUD)
      document.getElementById('btn-quick-book').addEventListener('click', () => spawnPlanarBook());
      document.getElementById('btn-hud-book').addEventListener('click', () => spawnPlanarBook());
      document.getElementById('btn-quick-card').addEventListener('click', () => spawnPlanarNoteCard());
      document.getElementById('btn-hud-card').addEventListener('click', () => spawnPlanarNoteCard());
      document.getElementById('btn-quick-graph').addEventListener('click', () => setPinnedGraphVisible(!state.graphVisible));
      document.getElementById('btn-hud-graph').addEventListener('click', () => setPinnedGraphVisible(!state.graphVisible));
      document.getElementById('btn-quick-clear').addEventListener('click', () => clearDynamicObjects());
      document.getElementById('btn-hud-clear').addEventListener('click', () => clearDynamicObjects());

      // Kiểu đồ thị ghim
      const graphBtns = Array.from(document.querySelectorAll('.graph-mode-btn'));
      const graphTag = document.getElementById('graph-mode-tag');
      graphBtns.forEach((btn) => {
        btn.addEventListener('click', () => {
          setPinnedGraphMode(btn.dataset.graph);
          if (graphTag) graphTag.textContent = btn.dataset.label;
          graphBtns.forEach((b) => b.classList.toggle('active', b === btn));
          if (!state.graphVisible) setPinnedGraphVisible(true);
        });
      });

      // Tự động sinh vật thể
      const swAutoSpawn = document.getElementById('sw-auto-spawn');
      swAutoSpawn.addEventListener('click', () => {
        state.autoSpawnEnabled = !state.autoSpawnEnabled;
        swAutoSpawn.classList.toggle('on', state.autoSpawnEnabled);
        swAutoSpawn.setAttribute('aria-checked', String(state.autoSpawnEnabled));
        if (state.autoSpawnEnabled) state.autoSpawnTimer = 2.0;
      });

      // Chế độ hoạt động
      const modeBtns = Array.from(document.querySelectorAll('.mode-btn'));
      const modeInd = document.getElementById('mode-indicator');
      function switchMode(newMode) {
        state.mode = newMode;
        modeBtns.forEach((b) => b.classList.toggle('active', b.dataset.mode === newMode));
        if (modeInd) modeInd.textContent = newMode === 'reading' ? 'ĐỌC TÀI LIỆU' : 'TƯƠNG TÁC CHUỘT';
        if (newMode === 'mouse') triggerNod(0.45);
        updateCaptionDisplay();
      }
      modeBtns.forEach((btn) => btn.addEventListener('click', () => switchMode(btn.dataset.mode)));

      // 7 biểu cảm
      document.querySelectorAll('.expr-btn').forEach((btn) => {
        btn.addEventListener('click', () => {
          setExpression(btn.dataset.expr, true);
          if (btn.dataset.expr === 'happy') triggerNod(0.60);
          if (btn.dataset.expr === 'surprised') triggerBlink();
          updateCaptionDisplay();
        });
      });

      // Tự động đổi biểu cảm theo văn bản
      const swAutoExpr = document.getElementById('sw-auto-expr');
      swAutoExpr.addEventListener('click', () => {
        state.autoExpression = !state.autoExpression;
        swAutoExpr.classList.toggle('on', state.autoExpression);
        swAutoExpr.setAttribute('aria-checked', String(state.autoExpression));
        if (state.autoExpression && state.docLines[state.lineIndex]) {
          setExpression(state.docLines[state.lineIndex].lineExpr, false);
        }
      });

      // 3 tài liệu mẫu
      const docBtns = Array.from(document.querySelectorAll('.doc-btn'));
      docBtns.forEach((btn) => {
        btn.addEventListener('click', () => {
          const idx = parseInt(btn.dataset.doc, 10);
          state.activeDocIndex = idx;
          docBtns.forEach((b) => b.classList.toggle('active', b === btn));
          const d = SAMPLE_DOCUMENTS[idx];
          loadVirtualDocument(d.title, d.body);
          if (state.mode !== 'reading') switchMode('reading');
        });
      });

      // Thanh trượt tốc độ đọc
      const sliderSpeed = document.getElementById('slider-speed');
      const valSpeed = document.getElementById('val-speed');
      sliderSpeed.addEventListener('input', (e) => {
        state.readSpeed = parseFloat(e.target.value);
        valSpeed.textContent = `${state.readSpeed.toFixed(1)}x`;
      });

      // Hiển thị khối Planar (4 chế độ)
      const headBtns = Array.from(document.querySelectorAll('.head-btn'));
      headBtns.forEach((btn) => {
        btn.addEventListener('click', () => {
          applyHeadStyle(btn.dataset.head);
          headBtns.forEach((b) => b.classList.toggle('active', b === btn));
        });
      });

      // Độ sáng viền cạnh Planar
      const sliderEdge = document.getElementById('slider-edge');
      const valEdge = document.getElementById('val-edge');
      sliderEdge.addEventListener('input', (e) => {
        state.edgeBrightness = parseFloat(e.target.value);
        valEdge.textContent = state.edgeBrightness.toFixed(2);
        if (state.headStyle !== 'sculpture') {
          planarEdgeUniforms.uOpacity.value = state.edgeBrightness;
          [leftEyeObj, rightEyeObj].forEach((eye) => {
            if (!eye) return;
            eye.lidRimLines.forEach((l) => { l.material.opacity = state.edgeBrightness * 0.85; });
          });
        }
      });

      // Mưa ma trận nền & Parallax chuột
      const swBgRain = document.getElementById('sw-bg-rain');
      swBgRain.addEventListener('click', () => {
        state.bgMatrixRain = !state.bgMatrixRain;
        swBgRain.classList.toggle('on', state.bgMatrixRain);
        swBgRain.setAttribute('aria-checked', String(state.bgMatrixRain));
      });

      const swParallax = document.getElementById('sw-parallax');
      swParallax.addEventListener('click', () => {
        state.parallaxEnabled = !state.parallaxEnabled;
        swParallax.classList.toggle('on', state.parallaxEnabled);
        swParallax.setAttribute('aria-checked', String(state.parallaxEnabled));
      });

      // Ẩn / Hiện thanh phụ đề
      const capBar = document.getElementById('caption-bar');
      const btnRestoreCap = document.getElementById('btn-restore-caption');
      document.getElementById('btn-hide-caption').addEventListener('click', () => {
        state.captionVisible = false;
        capBar.classList.add('hidden');
        btnRestoreCap.classList.add('visible');
      });
      btnRestoreCap.addEventListener('click', () => {
        state.captionVisible = true;
        capBar.classList.remove('hidden');
        btnRestoreCap.classList.remove('visible');
      });

      // Modal Nhập văn bản riêng
      const modal = document.getElementById('custom-modal');
      const titleInput = document.getElementById('custom-title');
      const bodyInput = document.getElementById('custom-body');
      const modalHint = document.getElementById('modal-hint');
      const openModal = () => {
        modal.classList.add('open');
        window.setTimeout(() => bodyInput.focus(), 30);
      };
      const closeModal = () => modal.classList.remove('open');

      document.getElementById('btn-open-custom').addEventListener('click', openModal);
      document.getElementById('btn-close-modal').addEventListener('click', closeModal);
      document.getElementById('btn-cancel-modal').addEventListener('click', closeModal);
      modal.addEventListener('click', (e) => {
        if (e.target === modal) closeModal();
      });

      const refreshHint = () => {
        const sample = `${titleInput.value}\n${bodyInput.value}`.trim();
        if (!sample) {
          modalHint.classList.remove('warn');
          modalHint.textContent = 'Mẹo: Thêm dấu ? (Suy tư), dấu ! (Ngạc nhiên / Vui vẻ) hoặc mã nguồn kỹ thuật (Tập trung) để thấy Theon đổi sắc thái tự động!';
          return;
        }
        const expr = detectExpressionFromText(sample, true);
        const meta = EXPRESSION_META[expr];
        modalHint.classList.add('warn');
        modalHint.textContent = `Sắc thái dự đoán: ${meta.label} — Theon sẽ đọc với biểu cảm này khi bật tự động.`;
      };
      titleInput.addEventListener('input', refreshHint);
      bodyInput.addEventListener('input', refreshHint);

      document.getElementById('btn-apply-modal').addEventListener('click', () => {
        const body = bodyInput.value.trim();
        if (!body) {
          modalHint.classList.add('warn');
          modalHint.textContent = 'Hãy dán ít nhất một dòng văn bản hoặc mã nguồn trước khi cho Theon đọc.';
          bodyInput.focus();
          return;
        }
        const title = titleInput.value.trim() || 'CUSTOM_NOTE.txt // VĂN BẢN RIÊNG';
        docBtns.forEach((b) => b.classList.remove('active'));
        loadVirtualDocument(title, body);
        if (state.mode !== 'reading') switchMode('reading');
        closeModal();
      });
    }

    try {
      initScene();
      animate();
      if (document.fonts && document.fonts.ready) {
        document.fonts.ready.then(() => {
          if (!running || !glyphAtlasTexture) return;
          const fresh = createMatrixGlyphAtlas();
          const previous = glyphAtlasTexture;
          glyphAtlasTexture = fresh;
          const applyAtlas = (mesh) => {
            if (mesh && mesh.material && mesh.material.uniforms && mesh.material.uniforms.uAtlas) {
              mesh.material.uniforms.uAtlas.value = fresh;
            }
          };
          if (emergenceSystem) applyAtlas(emergenceSystem.inst.mesh);
          if (bgRainSystem) applyAtlas(bgRainSystem.inst.mesh);
          for (let i = 0; i < matrixBursts.length; i++) applyAtlas(matrixBursts[i].inst.mesh);
          if (previous && previous !== fresh) previous.dispose();
          const early = state.matrixActive || (state.lineIndex === 0 && state.chunkIndex === 0);
          if (early && state.docRawBody) loadVirtualDocument(state.docTitle, state.docRawBody);
          else renderVirtualScreenCanvas();
        });
      }
    } catch (err) {
      const overlay = document.getElementById('webgl-error');
      const msg = document.getElementById('webgl-error-msg');
      if (overlay) overlay.classList.add('open');
      if (msg) {
        msg.textContent = (err && err.message)
          ? err.message
          : 'Trình duyệt chưa bật WebGL hoặc không hỗ trợ tăng tốc phần cứng.';
      }
      console.error(err);
    }

    const stop = () => {
      if (activeStop === stop) activeStop = null;
      running = false;
      if (rafId) cancelAnimationFrame(rafId);
      abort.abort();
      if (renderer) {
        const el = renderer.domElement;
        renderer.dispose();
        if (el && el.parentNode) el.parentNode.removeChild(el);
        renderer = null;
      }
    };
    activeStop = stop;
    return stop;
  }
