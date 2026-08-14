import type { AudioLibraryView } from "@/modules/audio/application/audio-facade";
import { formatByteSize } from "@/modules/audio/domain/media-asset";
import { isFakeSpeechProvider } from "@/modules/audio/domain/speech-provider";
import { audioSourcePath } from "@/modules/audio/domain/speech-clip";
import { deleteAudioAction } from "./actions";
import { DeleteAudioForm } from "./delete-audio-form";

interface AudioLibraryProps {
  readonly view: AudioLibraryView;
}

/**
 * Every clip StudyBench has stored, with what it would use for the next one.
 *
 * This exists because of how the cache is keyed. An asset belongs to the text that was
 * spoken, not to the card that asked for it, so nothing deletes audio implicitly:
 * retiring a card, editing its term, or deleting the card itself all leave the clip in
 * place, correctly, since the same phrase may be on another card. That makes an
 * explicit list the only honest way to answer "what am I storing, and how much of it"
 * — and it satisfies the acceptance criterion that audio assets can be deleted
 * (`SPEC.md` section 28.3).
 *
 * The clips are identified by voice, language, rate, and size rather than by their
 * text, because the text is not stored: the row holds a hash. That is a deliberate
 * privacy property — a filename or a listing never carries the owner's content — and
 * the player is here so a clip can be identified by ear before it is removed.
 *
 * **This is the one surface that may name a variable.** Study screens must not: an owner
 * mid-card is learning Mandarin, not configuring a provider, and they render no audio
 * control at all until speech is configured. But then something has to say where the
 * feature went, and a settings page is exactly the place — so when the placeholder
 * provider is in use this leads with what to set instead of listing voices that nothing
 * would speak with.
 */
export function AudioLibrary({ view }: AudioLibraryProps) {
  if (isFakeSpeechProvider(view.provider)) {
    return (
      <>
        <SetupPanel />
        {/* Anything already stored stays listed and stays removable. Reconfiguring must
            not make a clip undeletable, and a clip the placeholder provider made is
            exactly the thing an owner wants gone. */}
        {view.assets.length === 0 ? null : <StoredClips assets={view.assets} />}
      </>
    );
  }

  return (
    <>
      <dl className="meta">
        <div className="meta-item">
          <dt>Stored clips</dt>
          <dd>{view.totalCount}</dd>
        </div>
        <div className="meta-item">
          <dt>Disk used</dt>
          <dd>{formatByteSize(view.totalByteSize)}</dd>
        </div>
        <div className="meta-item">
          <dt>Speech provider</dt>
          <dd>{view.provider}</dd>
        </div>
        <div className="meta-item">
          <dt>Mandarin voice</dt>
          <dd>{view.voiceIdZh}</dd>
        </div>
        <div className="meta-item">
          <dt>English voice</dt>
          <dd>{view.voiceIdEn}</dd>
        </div>
        <div className="meta-item">
          <dt>Engine</dt>
          <dd>{view.engine}</dd>
        </div>
      </dl>

      {view.assets.length === 0 ? (
        <p className="empty-state">
          Nothing is stored yet. Open a vocabulary card and press play beside
          the term to hear it.
        </p>
      ) : (
        <StoredClips assets={view.assets} />
      )}
    </>
  );
}

/**
 * The stored clips, with a player and removal for each.
 *
 * The native `<audio controls>` stays *here*, and only here. On a study screen it was
 * the wrong control — a transport bar next to a two-character word — but this page's job
 * is to let a clip be identified before it is deleted, and since the text is not stored,
 * the only way to identify one is to listen to it. A scrub bar is useful for that.
 */
function StoredClips({
  assets,
}: {
  readonly assets: AudioLibraryView["assets"];
}) {
  return (
    <ul className="card-list">
      {assets.map((asset) => (
        <li className="card" key={asset.id}>
          <div className="card-heading">
            <span className="badge">
              {asset.language === "zh" ? "Mandarin" : "English"}
            </span>
            <span className="badge">{asset.voiceId}</span>
            <span className="badge">{asset.engine}</span>
            {asset.speechRate === "medium" ? null : (
              <span className="badge">{asset.speechRate}</span>
            )}
            <span className="badge">{formatByteSize(asset.byteSize)}</span>
          </div>
          <audio
            className="audio-clip-player"
            controls
            preload="none"
            src={audioSourcePath(asset.id)}
            aria-label={`Clip stored on ${asset.createdAt.slice(0, 10)}`}
          />
          <p className="card-text">Stored {asset.createdAt.slice(0, 10)}</p>
          <DeleteAudioForm
            action={deleteAudioAction}
            assetId={asset.id}
            revalidatePath="/settings/audio"
          />
        </li>
      ))}
    </ul>
  );
}

/**
 * What to set so that audio works.
 *
 * The fix for the failure that shipped: with `SPEECH_PROVIDER` unset, the placeholder
 * provider produced valid-but-silent MP3s, so the feature looked configured, looked like
 * it worked, and then played nothing. The study screens now render no control at all in
 * that state, which leaves exactly one thing to explain — and this is where it belongs,
 * because a settings page is a management surface and may name a variable.
 *
 * No voices, no engine, no clip count above it: none of them describes anything that
 * would happen. Naming the current provider would be worse than useless, since `fake` is
 * not a word the owner has any reason to attach meaning to.
 *
 * No credential is named beyond "your AWS profile". StudyBench never reads, stores, logs,
 * or renders one; the Polly client resolves them through the AWS default provider chain
 * (`spec/SECURITY.md`).
 */
function SetupPanel() {
  return (
    <div className="empty-state" role="status">
      <p>
        <strong>Audio is not configured.</strong> Add{" "}
        <code>SPEECH_PROVIDER=polly</code> to <code>.env.local</code> (plus AWS
        credentials via your profile) to enable pronunciation.
      </p>
      <p>
        Until then, no card or question offers to be read aloud. Nothing is
        broken and nothing is stored — a play button that made no sound would be
        harder to explain than none at all.
      </p>
    </div>
  );
}
