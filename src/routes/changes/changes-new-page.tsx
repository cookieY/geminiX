import { useTranslation } from "react-i18next";
import SubmissionWizard from "./submission-wizard";

/**
 * Change submission entry (route /changes/new; migration contract §2,
 * wizard ruling §18.34): hosts the create mode of the submission wizard —
 * step 1 collects the review flow, title and description; continuing
 * creates the draft and the journey continues at
 * /changes/drafts/:id (step 2, SQL + review).
 */

export default function ChangesNewPage() {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-2xl font-semibold">{t("precheck.new.title")}</h1>
        <p className="text-muted-foreground mt-1 text-sm">{t("precheck.new.description")}</p>
      </div>
      <SubmissionWizard mode="create" />
    </div>
  );
}
