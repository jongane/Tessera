import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  type Label,
  LabelColour,
  type ProjectMember,
} from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { findVisibleCard } from '../cards/card-access.js';

const MAX_NAME_LENGTH = 50;

export interface NewLabel {
  name: string;
  // One of the fixed colours (LabelColour), e.g. "RED".
  colour: string;
}

export type LabelChanges = Partial<NewLabel>;

// Labels shared across a project (docs/card-features.md, section 8). Any
// member can create a label and put labels on cards; only admins can
// rename, recolour or delete one.
@Injectable()
export class LabelsService {
  constructor(private readonly prisma: PrismaService) {}

  async createLabel(
    userId: string,
    projectId: string,
    label: NewLabel,
  ): Promise<Label> {
    await this.findMembership(userId, projectId);
    const name = requireName(label.name);
    await this.checkNameFree(projectId, name);
    return this.prisma.label.create({
      data: { projectId, name, colour: requireColour(label.colour) },
    });
  }

  async listLabels(userId: string, projectId: string): Promise<Label[]> {
    await this.findMembership(userId, projectId);
    return byName(await this.prisma.label.findMany({ where: { projectId } }));
  }

  async updateLabel(
    userId: string,
    labelId: string,
    changes: LabelChanges,
  ): Promise<Label> {
    const label = await this.findLabelForAdmin(userId, labelId);
    const name =
      changes.name === undefined ? undefined : requireName(changes.name);
    if (name !== undefined) {
      await this.checkNameFree(label.projectId, name, label.id);
    }
    return this.prisma.label.update({
      where: { id: label.id },
      data: {
        name,
        colour:
          changes.colour === undefined
            ? undefined
            : requireColour(changes.colour),
      },
    });
  }

  // Also takes the label off every card that has it.
  async deleteLabel(userId: string, labelId: string): Promise<void> {
    const label = await this.findLabelForAdmin(userId, labelId);
    await this.prisma.label.delete({ where: { id: label.id } });
  }

  async addLabelToCard(
    userId: string,
    cardId: string,
    labelId: string,
  ): Promise<void> {
    const card = await findVisibleCard(this.prisma, userId, cardId);
    const label = await this.prisma.label.findFirst({
      where: { id: labelId, projectId: card.projectId },
    });
    if (!label) {
      throw new NotFoundException('Label not found');
    }
    await this.prisma.cardLabel.upsert({
      where: { cardId_labelId: { cardId: card.id, labelId: label.id } },
      create: { cardId: card.id, labelId: label.id, projectId: card.projectId },
      update: {},
    });
  }

  async removeLabelFromCard(
    userId: string,
    cardId: string,
    labelId: string,
  ): Promise<void> {
    const card = await findVisibleCard(this.prisma, userId, cardId);
    await this.prisma.cardLabel.deleteMany({
      where: { cardId: card.id, labelId },
    });
  }

  async labelsForCard(userId: string, cardId: string): Promise<Label[]> {
    const card = await findVisibleCard(this.prisma, userId, cardId);
    return byName(
      await this.prisma.label.findMany({
        where: { cards: { some: { cardId: card.id } } },
      }),
    );
  }

  private async findMembership(
    userId: string,
    projectId: string,
  ): Promise<ProjectMember> {
    const membership = await this.prisma.projectMember.findUnique({
      where: { projectId_userId: { projectId, userId } },
    });
    if (!membership) {
      throw new NotFoundException('Project not found');
    }
    return membership;
  }

  private async findLabelForAdmin(
    userId: string,
    labelId: string,
  ): Promise<Label> {
    const label = await this.prisma.label.findUnique({
      where: { id: labelId },
    });
    const membership =
      label &&
      (await this.prisma.projectMember.findUnique({
        where: { projectId_userId: { projectId: label.projectId, userId } },
      }));
    if (!label || !membership) {
      throw new NotFoundException('Label not found');
    }
    if (membership.role !== 'ADMIN') {
      throw new ForbiddenException(
        'Only a project admin can rename, recolour or delete a label',
      );
    }
    return label;
  }

  // Names are compared ignoring letter case, so "Bug" and "bug" cannot both
  // exist. A label can be renamed to a new case of its own name.
  private async checkNameFree(
    projectId: string,
    name: string,
    exceptLabelId?: string,
  ): Promise<void> {
    const clash = await this.prisma.label.findFirst({
      where: {
        projectId,
        name: { equals: name, mode: 'insensitive' },
        id: exceptLabelId ? { not: exceptLabelId } : undefined,
      },
    });
    if (clash) {
      throw new ConflictException(
        `A label called ${clash.name} already exists`,
      );
    }
  }
}

function requireName(name: string): string {
  const trimmed = name.trim();
  if (trimmed.length === 0 || trimmed.length > MAX_NAME_LENGTH) {
    throw new BadRequestException(
      `A label name must be 1 to ${MAX_NAME_LENGTH} characters`,
    );
  }
  return trimmed;
}

function requireColour(colour: string): LabelColour {
  const colours: string[] = Object.values(LabelColour);
  if (!colours.includes(colour)) {
    throw new BadRequestException(
      `A label colour must be one of ${colours.join(', ')}`,
    );
  }
  return colour as LabelColour;
}

function byName(labels: Label[]): Label[] {
  return labels.sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }),
  );
}
