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
import { t } from "../i18n";

function PhaseShiftingTheory() {
  return (
    <section id="phase-shifting">
      <h2>{t("從亮度到相位", "From brightness to phase")}</h2>
      <p>
        {t(
          <>
            Camera 只記錄亮度。投影 N 張相移的正弦條紋，同一個像素就有 N
            個亮度；三個未知數
            A（平均亮度）、B（調變）、φ（條紋內的位置）可以從中解出。以三步相移為例：
          </>,
          <>
            The Camera records only brightness. Project N phase-shifted
            sinusoidal fringe patterns and each pixel gets N brightness values,
            enough to solve for three unknowns: A (mean brightness), B
            (modulation), and φ (position within the fringe). Take three-step
            phase shifting as an example:
          </>,
        )}
      </p>
      <MathBlock>{String.raw`
I_k = A + B\cos(\varphi + \delta_k), \qquad \delta_k = 0,\ \tfrac{2\pi}{3},\ \tfrac{4\pi}{3}`}</MathBlock>
      <MathBlock>{String.raw`
\hat\varphi = \operatorname{atan2}\!\bigl(\sqrt3\,(I_3 - I_2),\ 2I_1 - I_2 - I_3\bigr) \in [-\pi, \pi),
\qquad
\hat B = \tfrac13\sqrt{3(I_3 - I_2)^2 + (2I_1 - I_2 - I_3)^2}`}</MathBlock>
      <ul>
        <li>
          {t(
            <>
              正負號與 <M>{"\\cos(\\varphi + \\delta)"}</M>{" "}
              的慣例、曝光順序綁在一起；交換影像就不能照抄公式。
            </>,
            <>
              The signs are tied to the <M>{"\\cos(\\varphi + \\delta)"}</M>{" "}
              convention and the exposure order; if you swap images, you
              can&apos;t copy the formula as is.
            </>,
          )}
        </li>
        <li>
          {t(
            <>
              <M>{"\\hat B"}</M> 太小（沒被照到、太暗）或有 clipping
              的像素，相位不可信，要標成無效，而不是填 0。
            </>,
            <>
              For pixels where <M>{"\\hat B"}</M> is too small (not lit, too
              dark) or that clip, the phase can&apos;t be trusted: mark them
              invalid instead of filling in 0.
            </>,
          )}
        </li>
        <li>
          {t(
            "Phase 是條紋內的位置，不是物體高度。",
            "Phase is the position within a fringe, not the object height.",
          )}
        </li>
      </ul>
      <p>
        {t(
          <>
            接下來到「實驗」分頁，跟著一步一步學親手算一次：看三張照片、讀一個像素、算出
            Phase。
          </>,
          <>
            Next, open the “Lab” tab and work through it once yourself in Step
            by step: look at three images, read one pixel, and compute the
            phase.
          </>,
        )}
      </p>
    </section>
  );
}

function UnwrappingTheory() {
  return (
    <section id="unwrapping">
      <h2>{t("補回整圈 2π", "Restoring whole 2π cycles")}</h2>
      <p>
        {t(
          <>
            atan2 只回傳 <M>{"[-\\pi, \\pi)"}</M>
            。條紋不只一個週期時，真正的相位是
          </>,
          <>
            atan2 only returns <M>{"[-\\pi, \\pi)"}</M>. When the fringes span
            more than one period, the true phase is
          </>,
        )}
      </p>
      <MathBlock>{String.raw`\Phi = \hat\varphi + 2\pi k, \qquad k \in \mathbb{Z}`}</MathBlock>
      <p>
        {t(
          "Unwrapping 就是決定每個像素的 k。兩種做法：",
          "Unwrapping means deciding k for every pixel. There are two approaches:",
        )}
      </p>
      <dl className="calib-defs">
        <dt>
          {t(
            "Spatial：沿著影像往旁邊累加",
            "Spatial: accumulate across the image",
          )}
        </dt>
        <dd>
          {t(
            <>
              相鄰像素的相位差取最短的那一個（加減 2π 讓它落在 ±π
              內），一路累加。前提是相鄰的真實相位差小於
              π；遇到斷崖、遮擋或雜訊就會整段錯一圈，而且每一段都還留著一個未知的
              2π 整數偏移。
            </>,
            <>
              Take the shortest phase difference between neighboring pixels (add
              or subtract 2π to bring it within ±π) and accumulate it along the
              way. This assumes the true phase difference between neighbors is
              less than π; a depth step, occlusion, or noise throws a whole
              stretch off by one cycle, and every segment still carries an
              unknown integer offset of 2π.
            </>,
          )}
        </dd>
        <dt>
          {t(
            "Temporal：再投一組低頻條紋",
            "Temporal: project an extra low-frequency set",
          )}
        </dt>
        <dd>
          {t(
            <>
              額外投一組只有一個週期的條紋，它的相位 <M>{"\\Phi_\\ell"}</M>{" "}
              沒有歧義，可以逐像素決定高頻條紋的級次：
            </>,
            <>
              Project an extra set of fringes with just one period. Its phase{" "}
              <M>{"\\Phi_\\ell"}</M> is unambiguous, so it can decide the fringe
              order of the high-frequency fringes pixel by pixel:
            </>,
          )}
          <MathBlock>{String.raw`
k = \operatorname{round}\!\left(\frac{\tfrac{f_h}{f_\ell}\,\Phi_\ell - \hat\varphi_h}{2\pi}\right)`}</MathBlock>
          {t(
            "每個像素各自決定，不受鄰居影響；代價是多拍幾張。",
            "Each pixel decides on its own, unaffected by its neighbors; the cost is a few more images.",
          )}
        </dd>
      </dl>
      <h3>
        {t("Temporal 什麼時候會猜錯", "When temporal unwrapping guesses wrong")}
      </h3>
      <p>
        {t(
          <>
            低頻相位的誤差 <M>{"\\varepsilon_\\ell"}</M> 會先乘上頻率比{" "}
            <M>{"r = f_h / f_\\ell"}</M>，才拿來決定 k。只要
          </>,
          <>
            The low-frequency phase error <M>{"\\varepsilon_\\ell"}</M> is first
            multiplied by the frequency ratio <M>{"r = f_h / f_\\ell"}</M>{" "}
            before it is used to decide k. Whenever
          </>,
        )}
      </p>
      <MathBlock>{String.raw`\left| r\,\varepsilon_\ell \right| \ge \pi`}</MathBlock>
      <p>
        {t(
          <>
            k 就會錯一整圈，那個像素的位置偏掉一個條紋週期。r 越大越怕雜訊，所以
            3D 實驗室不直接從 1 跳到 16，而是分成 {"{1, 4, 16}"} 三層：每層 r =
            4，容許的誤差是 r = 16 的 4
            倍。另外，最粗那層必須在整個量測範圍內只有一個週期，而且不能跨過
            0／2π 的接縫。
          </>,
          <>
            k is off by a whole cycle, and that pixel&apos;s position shifts by
            one fringe period. The larger r is, the more sensitive it is to
            noise, so the 3D lab doesn&apos;t jump straight from 1 to 16 but
            uses three levels, {"{1, 4, 16}"}: each level has r = 4, which
            tolerates 4 times the error of r = 16. Also, the coarsest level must
            have only one period across the whole measurement range and must not
            cross the 0/2π seam.
          </>,
        )}
      </p>
      <h3>{t("交給下一站", "Handing off to the next station")}</h3>
      <p>
        {t(
          <>
            絕對相位 <M>{"\\Phi"}</M> 換成 Projector 像素：
          </>,
          <>
            Convert the absolute phase <M>{"\\Phi"}</M> to Projector pixels:
          </>,
        )}
      </p>
      <MathBlock>{String.raw`u_p = \frac{\Phi\, W_p}{2\pi f_h}`}</MathBlock>
      <p>
        {t(
          <>
            <M>{"W_p"}</M> 是 Projector 寬度（px）。垂直條紋得到 <M>{"u_p"}</M>
            ，再投一組水平條紋得到 <M>{"v_p"}</M>；第 5 站校正 Projector、第 6
            站三角量測都需要這個對應。
          </>,
          <>
            <M>{"W_p"}</M> is the Projector width (px). Vertical fringes give{" "}
            <M>{"u_p"}</M>; project another set of horizontal fringes to get{" "}
            <M>{"v_p"}</M>. Projector calibration in Station 5 and triangulation
            in Station 6 both need this correspondence.
          </>,
        )}
      </p>
    </section>
  );
}

function PlannedTheory() {
  return (
    <section id="planned">
      <h2>{t("這一站還在規劃中", "This station is still being planned")}</h2>
      <p>{t("預計涵蓋：", "It will cover:")}</p>
      <ul>
        <li>
          {t(
            "Gamma 與非線性亮度響應造成的相位誤差。",
            "Phase errors caused by gamma and nonlinear brightness response.",
          )}
        </li>
        <li>
          {t(
            "互反射、鏡面反射與失焦：3D 沙盒已能模擬，但還沒有整理成診斷流程。",
            "Interreflection, specular reflection, and defocus: the 3D sandbox can already simulate them, but they aren't organized into a diagnostic workflow yet.",
          )}
        </li>
        <li>
          {t(
            "級次錯誤與量測範圍混疊：怎麼從點雲看出來。",
            "Fringe order errors and measurement-range aliasing: how to spot them in the point cloud.",
          )}
        </li>
      </ul>
      <p>
        {t(
          "在此之前，可以先讀校正相關的常見錯誤：",
          "Until then, you can read the common calibration mistakes:",
        )}
      </p>
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
    title: t(
      "實驗 A + B：校正一套 Camera + Projector（角點直接給定）",
      "Labs A + B: calibrate a Camera + Projector pair (corners given directly)",
    ),
    body: (
      <>
        <p>
          {t(
            <>
              模擬一套結構光：Camera 1280 × 1024，Projector 1024 × 768，相距約
              17 cm。每個姿態同時產生 Camera 角點與 Projector
              角點（後者代表由相位求得的座標）。計算全在瀏覽器裡用實際演算法執行（Homography
              + Zhang 初值 +
              Levenberg–Marquardt）；真值只用來產生「觀測」與評分。
            </>,
            <>
              A simulated structured-light setup: Camera 1280 × 1024, Projector
              1024 × 768, about 17 cm apart. Each pose produces both Camera
              corners and Projector corners (the latter stand for coordinates
              recovered from phase). Everything runs in your browser with the
              real algorithms (homography + Zhang initialization +
              Levenberg–Marquardt); the ground truth is used only to generate
              the “observations” and to score the results.
            </>,
          )}
        </p>
        <CalibrationLabView />
      </>
    ),
  },
  "registration-c": {
    title: t(
      "實驗 C：兩台 Scanner 的座標統合",
      "Lab C: registering two Scanners into one frame",
    ),
    body: (
      <>
        <p>
          {t(
            <>
              兩台 Scanner 從左右兩側斜拍平台上的半球。各自的點雲先在自己的
              Camera 座標，再用選定的方法換到世界座標。
            </>,
            <>
              Two Scanners view a hemisphere on the stage at an angle from the
              left and right. Each point cloud starts in its own Camera frame
              and is then transformed into world coordinates with the method you
              choose.
            </>,
          )}
        </p>
        <RegistrationLabView />
      </>
    ),
  },
} satisfies Record<string, { title: string; body: ReactNode }>;
