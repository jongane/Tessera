import { LABEL_COLOURS, type LabelColourName } from '@tessera/shared'
import { useId } from 'react'
import { LABEL_COLOUR_NAMES, LABEL_STYLES } from '../boards/card-text'

// The 10 fixed colours, as radio buttons showing each colour.
export function ColourPicker({
  value,
  onChange,
}: {
  value: LabelColourName
  onChange: (colour: LabelColourName) => void
}) {
  const name = useId()
  return (
    <fieldset className="flex flex-col gap-1.5">
      <legend className="mb-1.5 font-semibold">Colour</legend>
      <div className="flex flex-wrap gap-2">
        {LABEL_COLOURS.map((colour) => (
          <label
            key={colour}
            className={`flex min-h-11 cursor-pointer items-center gap-1.5 rounded-lg px-3 font-semibold has-checked:ring-2 has-checked:ring-accent has-focus-visible:outline-2 ${LABEL_STYLES[colour]}`}
          >
            <input
              type="radio"
              name={name}
              value={colour}
              checked={value === colour}
              onChange={() => onChange(colour)}
              className="accent-current"
            />
            {LABEL_COLOUR_NAMES[colour]}
          </label>
        ))}
      </div>
    </fieldset>
  )
}
