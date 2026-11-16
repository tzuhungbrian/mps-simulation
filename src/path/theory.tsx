import type { ReactNode } from "react";
import {
  CameraCalibrationSection,
  CameraModelSection,
  DistortionSection,
  ExtrinsicsSection,
  FusionSection,
  PitfallsSection,
  ProjectorCalibrationSection,
  RegistrationSection,
  TriangulationSection,
} from "../calibration/CourseSections";
import {
  CalibrationLabView,
  RegistrationLabView,
} from "../calibration/CalibrationLabs";
import { M, MathBlock } from "../calibration/Tex";

function PhaseShiftingTheory() {
  return (
    <section id="phase-shifting">
      <h2>從亮度到相位</h2>
      <p>
        Camera 只記錄亮度。投影 N 張相移的正弦條紋，同一個像素就有 N
        個亮度；三個未知數
        A（平均亮度）、B（調變）、φ（條紋內的位置）可以從中解出。以三步相移為例：
      </p>
      <MathBlock>{String.raw`
I_k = A + B\cos(\varphi + \delta_k), \qquad \delta_k = 0,\ \tfrac{2\pi}{3},\ \tfrac{4\pi}{3}`}</MathBlock>
      <MathBlock>{String.raw`
\hat\varphi = \operatorname{atan2}\!\bigl(\sqrt3\,(I_3 - I_2),\ 2I_1 - I_2 - I_3\bigr) \in [-\pi, \pi),
\qquad
\hat B = \tfrac13\sqrt{3(I_3 - I_2)^2 + (2I_1 - I_2 - I_3)^2}`}</MathBlock>
      <ul>
        <li>
          正負號與 <M>{"\\cos(\\varphi + \\delta)"}</M>{" "}
          的慣例、曝光順序綁在一起；交換影像就不能照抄公式。
        </li>
        <li>
          <M>{"\\hat B"}</M> 太小（沒被照到、太暗）或有 clipping
          的像素，相位不可信，要標成無效，而不是填 0。
        </li>
        <li>Phase 是條紋內的位置，不是物體高度。</li>
      </ul>
      <p>
        接下來到「實驗」分頁，跟著一步一步學親手算一次：看三張照片、讀一個像素、算出
        Phase。
      </p>
    </section>
  );
}

function UnwrappingTheory() {
  return (
    <section id="unwrapping">
      <h2>補回整圈 2π</h2>
      <p>
        atan2 只回傳 <M>{"[-\\pi, \\pi)"}</M>。條紋不只一個週期時，真正的相位是
      </p>
      <MathBlock>{String.raw`\Phi = \hat\varphi + 2\pi k, \qquad k \in \mathbb{Z}`}</MathBlock>
      <p>Unwrapping 就是決定每個像素的 k。兩種做法：</p>
      <dl className="calib-defs">
        <dt>Spatial：沿著影像往旁邊累加</dt>
        <dd>
          相鄰像素的相位差取最短的那一個（加減 2π 讓它落在 ±π
          內），一路累加。前提是相鄰的真實相位差小於
          π；遇到斷崖、遮擋或雜訊就會整段錯一圈，而且每一段都還留著一個未知的 2π
          整數偏移。
        </dd>
        <dt>Temporal：再投一組低頻條紋</dt>
        <dd>
          額外投一組只有一個週期的條紋，它的相位 <M>{"\\Phi_\\ell"}</M>{" "}
          沒有歧義，可以逐像素決定高頻條紋的級次：
          <MathBlock>{String.raw`
k = \operatorname{round}\!\left(\frac{\tfrac{f_h}{f_\ell}\,\Phi_\ell - \hat\varphi_h}{2\pi}\right)`}</MathBlock>
          每個像素各自決定，不受鄰居影響；代價是多拍幾張。3D 實驗室使用{" "}
          {"{1, 4, 16}"} 三組頻率。
        </dd>
      </dl>
      <p>
        得到的絕對相位 <M>{"\\Phi"}</M> 才能換成 Projector 座標：第 5 站校正
        Projector、第 6 站三角量測都需要它。
      </p>
    </section>
  );
}

function PlannedTheory() {
  return (
    <section id="planned">
      <h2>這一站還在規劃中</h2>
      <p>預計涵蓋：</p>
      <ul>
        <li>Gamma 與非線性亮度響應造成的相位誤差。</li>
        <li>
          互反射、鏡面反射與失焦：3D 沙盒已能模擬，但還沒有整理成診斷流程。
        </li>
        <li>級次錯誤與量測範圍混疊：怎麼從點雲看出來。</li>
      </ul>
      <p>在此之前，可以先讀校正相關的常見錯誤：</p>
    </section>
  );
}

export const THEORY: Record<number, ReactNode> = {
  1: (
    <>
      <CameraModelSection />
      <ExtrinsicsSection />
    </>
  ),
  2: (
    <>
      <DistortionSection />
      <CameraCalibrationSection />
    </>
  ),
  3: <PhaseShiftingTheory />,
  4: <UnwrappingTheory />,
  5: <ProjectorCalibrationSection />,
  6: <TriangulationSection />,
  7: (
    <>
      <PlannedTheory />
      <PitfallsSection />
    </>
  ),
  8: <RegistrationSection />,
  9: <FusionSection />,
};

export const INLINE_LABS = {
  "calibration-ab": {
    title: "實驗 A + B：校正一套 Camera + Projector（角點直接給定）",
    body: (
      <>
        <p>
          模擬一套結構光：Camera 1280 × 1024，Projector 1024 × 768，相距約 17
          cm。每個姿態同時產生 Camera 角點與 Projector
          角點（後者代表由相位求得的座標）。計算全在瀏覽器裡用實際演算法執行（Homography
          + Zhang 初值 + Levenberg–Marquardt）；真值只用來產生「觀測」與評分。
        </p>
        <CalibrationLabView />
      </>
    ),
  },
  "registration-c": {
    title: "實驗 C：兩台 Scanner 的座標統合",
    body: (
      <>
        <p>
          兩台 Scanner 從左右兩側斜拍平台上的半球。各自的點雲先在自己的 Camera
          座標，再用選定的方法換到世界座標。
        </p>
        <RegistrationLabView />
      </>
    ),
  },
} satisfies Record<string, { title: string; body: ReactNode }>;
